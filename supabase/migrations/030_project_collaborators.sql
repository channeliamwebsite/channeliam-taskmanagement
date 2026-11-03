-- =============================================================================
-- 030_project_collaborators.sql   (permission change: project-level access for
-- people from other workspaces; additive)
--
-- Decided 2026-10-30: cross-workspace assignment works only through an
-- explicit, project-level grant, without making the person a member of the
-- other workspace.
--
-- public.project_collaborators (project, user, granted_by, granted_at):
--   * granted and revoked by super admins only (company-level, 025);
--   * the person must be an active employee who is not already a member of the
--     project's workspace (members need no grant);
--   * revoking is refused while the person still has open assignments
--     (not COMPLETED / CANCELLED) in that project;
--   * grants and revocations are audited in the project's workspace
--     (COLLABORATOR_ADDED / COLLABORATOR_REMOVED, actor = the super admin).
--
-- What a collaborator can do:
--   * be assigned tasks of that project by the people who manage those tasks
--     (task_assignees policies unchanged; the 003 assignee check now also
--     accepts an active collaborator of the task's project);
--   * see the tasks of that project they are assigned to (with their subtasks
--     and parents), their comments, time and attachments, update status and
--     progress (existing assignee rules), comment;
--   * see that project's row and the people on the tasks they can see.
-- What they cannot see: the workspace itself, its members, clients, other
-- projects, other tasks of the project, reports, meetings or activity. None of
-- the membership helpers change.
-- =============================================================================

alter type public.activity_action add value if not exists 'COLLABORATOR_ADDED';
alter type public.activity_action add value if not exists 'COLLABORATOR_REMOVED';

create table if not exists public.project_collaborators (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  granted_by uuid default auth.uid() references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_collaborators_user_idx on public.project_collaborators (user_id);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.is_project_collaborator(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.project_collaborators pc
    join public.profiles p on p.id = pc.user_id and p.is_active
    where pc.project_id = p_project_id and pc.user_id = (select auth.uid())
  )
$$;

-- Same as 025, plus: tasks of a project the caller collaborates on that are
-- assigned to the caller.
create or replace function private.accessible_task_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  with recursive
  me as (
    select (select auth.uid()) as uid, private.current_user_role() as role
  ),
  ws as (
    select private.my_workspace_ids() as workspace_id
  ),
  base as (
    select t.id
    from public.tasks t
    where private.is_company_admin()
    union
    select t.id
    from public.tasks t
    join ws on ws.workspace_id = t.workspace_id
    where t.created_by = (select uid from me)
    union
    select t.id
    from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
    join ws on ws.workspace_id = t.workspace_id
    where ta.user_id = (select uid from me) or ta.assigned_by = (select uid from me)
    union
    select t.id
    from public.projects pr
    join ws on ws.workspace_id = pr.workspace_id
    join public.tasks t on t.project_id = pr.id
    where pr.owner_id = (select uid from me) or pr.created_by = (select uid from me)
    union
    -- tasks assigned to the caller's direct reports (team lead view)
    select t.id
    from public.profiles rep
    join public.task_assignees ta on ta.user_id = rep.id
    join public.tasks t on t.id = ta.task_id
    join ws on ws.workspace_id = t.workspace_id
    where rep.manager_id = (select uid from me)
      and (select role from me) in ('SUPER_ADMIN', 'ADMIN')
    union
    -- 030: collaborators see the tasks of their projects assigned to them
    select t.id
    from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
    join public.project_collaborators pc on pc.project_id = t.project_id and pc.user_id = ta.user_id
    where ta.user_id = (select uid from me)
  ),
  descendants as (
    select id from base
    union
    select t.id from public.tasks t join descendants d on t.parent_task_id = d.id
  ),
  ancestors as (
    select t.parent_task_id as id
    from public.tasks t join base b on b.id = t.id
    where t.parent_task_id is not null
    union
    select t.parent_task_id
    from public.tasks t join ancestors a on t.id = a.id
    where t.parent_task_id is not null
  )
  select id from descendants
  where (select role from me) is not null
  union
  select id from ancestors
  where (select role from me) is not null
$$;

-- -----------------------------------------------------------------------------
-- Assignees: a member of the task's workspace, or a collaborator on its project
-- (same as 003 otherwise)
-- -----------------------------------------------------------------------------
create or replace function private.validate_task_assignee()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_project_id uuid;
begin
  if tg_op = 'UPDATE' and (new.task_id, new.user_id) is distinct from (old.task_id, old.user_id) then
    raise exception 'Reassign by removing and adding assignees' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    select t.workspace_id, t.project_id into v_workspace_id, v_project_id from public.tasks t where t.id = new.task_id;
    if not (
      private.is_active_workspace_member(v_workspace_id, new.user_id)
      or exists (
        select 1 from public.project_collaborators pc
        join public.profiles p on p.id = pc.user_id and p.is_active
        where pc.project_id = v_project_id and pc.user_id = new.user_id
      )
    ) then
      raise exception 'Assignee must be an active member of the task''s workspace' using errcode = '23514';
    end if;
  end if;

  if new.is_primary then
    update public.task_assignees
    set is_primary = false
    where task_id = new.task_id and user_id <> new.user_id and is_primary;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants: validation, revocation guard, audit
-- -----------------------------------------------------------------------------
create or replace function private.validate_project_collaborator()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select pr.workspace_id into v_ws from public.projects pr where pr.id = new.project_id;
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.is_active) then
    raise exception 'Only active employees can be given project access' using errcode = '23514';
  end if;
  if exists (select 1 from public.workspace_members wm where wm.workspace_id = v_ws and wm.user_id = new.user_id) then
    raise exception 'This person is already a member of the project''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_project_collaborator on public.project_collaborators;
create trigger validate_project_collaborator before insert or update on public.project_collaborators
  for each row execute function private.validate_project_collaborator();

create or replace function private.protect_collaborator_assignments()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Removing the project or the person: nothing left to protect.
  if not exists (select 1 from public.projects where id = old.project_id)
     or not exists (select 1 from public.profiles where id = old.user_id) then
    return old;
  end if;
  if exists (
    select 1 from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
    where ta.user_id = old.user_id and t.project_id = old.project_id
      and t.status not in ('COMPLETED', 'CANCELLED')
  ) then
    raise exception 'This person still has open assignments in the project. Reassign or finish them first.' using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_collaborator_assignments on public.project_collaborators;
create trigger protect_collaborator_assignments before delete on public.project_collaborators
  for each row execute function private.protect_collaborator_assignments();

create or replace function private.log_collaborator_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws uuid;
begin
  if tg_op = 'INSERT' then
    select workspace_id into v_ws from public.projects where id = new.project_id;
    perform private.log_audit(v_ws, new.project_id, new.user_id, 'COLLABORATOR_ADDED');
  else
    select workspace_id into v_ws from public.projects where id = old.project_id;
    if v_ws is null or not exists (select 1 from public.profiles where id = old.user_id) then
      return null;
    end if;
    perform private.log_audit(v_ws, old.project_id, old.user_id, 'COLLABORATOR_REMOVED');
  end if;
  return null;
end;
$$;

drop trigger if exists log_collaborator_audit on public.project_collaborators;
create trigger log_collaborator_audit after insert or delete on public.project_collaborators
  for each row execute function private.log_collaborator_audit();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.project_collaborators enable row level security;
revoke all on public.project_collaborators from public, anon, authenticated;
grant select, insert, delete on public.project_collaborators to authenticated;

-- Super admins, admins of the project's workspace (to assign them), the person.
drop policy if exists "project_collaborators: read" on public.project_collaborators;
create policy "project_collaborators: read"
  on public.project_collaborators for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_company_admin())
    or exists (
      select 1 from public.projects pr
      where pr.id = project_id
        and private.has_workspace_role(pr.workspace_id, array['ADMIN']::public.user_role[])
    )
  );

drop policy if exists "project_collaborators: super admins grant" on public.project_collaborators;
create policy "project_collaborators: super admins grant"
  on public.project_collaborators for insert to authenticated
  with check (granted_by = (select auth.uid()) and (select private.is_company_admin()));

drop policy if exists "project_collaborators: super admins revoke" on public.project_collaborators;
create policy "project_collaborators: super admins revoke"
  on public.project_collaborators for delete to authenticated
  using ((select private.is_company_admin()));

-- The collaborator sees the project row (name, dates); nothing else of the workspace.
drop policy if exists "projects: collaborators read their projects" on public.projects;
create policy "projects: collaborators read their projects"
  on public.projects for select to authenticated
  using (private.is_project_collaborator(id));

-- Collaborators see the people on the tasks they can see (names on cards).
drop policy if exists "profiles: collaborators read people on their tasks" on public.profiles;
create policy "profiles: collaborators read people on their tasks"
  on public.profiles for select to authenticated
  using (
    exists (select 1 from public.project_collaborators pc where pc.user_id = (select auth.uid()))
    and id in (
      select ta.user_id from public.task_assignees ta where ta.task_id in (select private.accessible_task_ids())
      union
      select ta.assigned_by from public.task_assignees ta where ta.task_id in (select private.accessible_task_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  private.validate_project_collaborator(),
  private.protect_collaborator_assignments(),
  private.log_collaborator_audit()
from public, anon, authenticated;
revoke all on function private.is_project_collaborator(uuid) from public, anon;
grant execute on function private.is_project_collaborator(uuid) to authenticated;
