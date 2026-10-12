-- =============================================================================
-- 004_clients_teams_reports.sql   (additive, non-destructive)
--   * clients table + projects.client_id (backfilled from projects.client_name)
--   * reporting structure: profiles.manager_id + profiles.team
--     (separate from task assignment; only super admins may change it)
--   * team leads can read tasks assigned to their direct reports
--   * daily_reports.work_remaining + linked_task_ids
--   * notifications when a task becomes BLOCKED or goes IN_REVIEW
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------
create table public.clients (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 200),
  contact_name  text,
  contact_email text,
  notes         text,
  is_active     boolean not null default true,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint clients_workspace_name_key unique (workspace_id, name)
);

create index clients_created_by_idx on public.clients (created_by);

alter table public.projects add column client_id uuid references public.clients (id) on delete set null;
create index projects_client_id_idx on public.projects (client_id);

-- Backfill from the free-text client_name (kept for compatibility).
insert into public.clients (workspace_id, name, created_by)
select distinct p.workspace_id, trim(p.client_name), null::uuid
from public.projects p
where p.client_name is not null and trim(p.client_name) <> ''
on conflict (workspace_id, name) do nothing;

update public.projects p
set client_id = c.id
from public.clients c
where p.client_id is null
  and c.workspace_id = p.workspace_id
  and c.name = trim(p.client_name);

create trigger set_updated_at before update on public.clients
  for each row execute function private.set_updated_at();

-- A project's client must belong to the same workspace.
create or replace function private.validate_project_client()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.client_id is not null and not exists (
    select 1 from public.clients c where c.id = new.client_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'Client must belong to the same workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_project_client before insert or update of client_id on public.projects
  for each row execute function private.validate_project_client();

alter table public.clients enable row level security;
revoke all on public.clients from anon, authenticated;
grant select, insert, delete on public.clients to authenticated;
grant update (name, contact_name, contact_email, notes, is_active) on public.clients to authenticated;
grant update (client_id) on public.projects to authenticated;

create policy "clients: members can read"
  on public.clients for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));

create policy "clients: admins can create"
  on public.clients for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[])
  );

create policy "clients: admins can update"
  on public.clients for update to authenticated
  using (private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[]))
  with check (private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[]));

create policy "clients: super admins can delete"
  on public.clients for delete to authenticated
  using (private.is_workspace_super_admin(workspace_id));

-- -----------------------------------------------------------------------------
-- Reporting structure (independent of task assignment)
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column manager_id uuid references public.profiles (id) on delete set null,
  add column team text check (team is null or char_length(team) <= 100),
  add constraint profiles_not_own_manager check (manager_id is null or manager_id <> id);

create index profiles_manager_id_idx on public.profiles (manager_id);

grant update (manager_id, team) on public.profiles to authenticated;

-- Extends the profile guard: manager/team are super-admin managed as well.
create or replace function private.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Profile id and email cannot be changed directly' using errcode = '42501';
  end if;

  if (new.role, new.is_active, new.department, new.job_title, new.manager_id, new.team)
     is distinct from (old.role, old.is_active, old.department, old.job_title, old.manager_id, old.team) then
    if private.current_user_role() is distinct from 'SUPER_ADMIN' then
      raise exception 'Only a super admin can change role, active status, department, job title, team or manager'
        using errcode = '42501';
    end if;
    if old.id = v_uid and (new.role, new.is_active) is distinct from (old.role, old.is_active) then
      raise exception 'Super admins cannot change their own role or deactivate themselves'
        using errcode = '42501';
    end if;
  end if;

  -- Reporting lines must not form loops (A manages B manages A).
  if new.manager_id is not null and new.manager_id is distinct from old.manager_id and exists (
    with recursive chain as (
      select new.manager_id as id
      union
      select p.manager_id from public.profiles p join chain c on p.id = c.id where p.manager_id is not null
    )
    select 1 from chain where id = new.id
  ) then
    raise exception 'Reporting lines cannot contain cycles' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Team leads additionally see tasks assigned to their direct reports.
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
    join ws on ws.workspace_id = t.workspace_id
    where (select role from me) = 'SUPER_ADMIN'
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
-- Daily reports: remaining work + linked tasks
-- -----------------------------------------------------------------------------
alter table public.daily_reports
  add column work_remaining text,
  add column linked_task_ids uuid[] not null default '{}';

grant update (work_remaining, linked_task_ids) on public.daily_reports to authenticated;

-- -----------------------------------------------------------------------------
-- Notifications: blocked tasks and review requests
-- -----------------------------------------------------------------------------
create or replace function private.notify_task_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_name text;
begin
  if new.status not in ('BLOCKED', 'IN_REVIEW') or new.status is not distinct from old.status then
    return null;
  end if;

  select coalesce(nullif(p.full_name, ''), p.email) into v_actor_name from public.profiles p where p.id = v_actor;

  insert into public.notifications (user_id, type, title, message, task_id, project_id)
  select r.user_id,
         'TASK_STATUS_CHANGED',
         case when new.status = 'BLOCKED' then 'Task blocked' else 'Review requested' end,
         format('%s marked "%s" as %s.', coalesce(v_actor_name, 'Someone'), new.title,
                case when new.status = 'BLOCKED' then 'blocked' else 'ready for review' end),
         new.id,
         new.project_id
  from (
    select new.created_by as user_id
    union
    select ta.assigned_by from public.task_assignees ta where ta.task_id = new.id
  ) r
  join public.profiles p on p.id = r.user_id and p.is_active
  where r.user_id is distinct from v_actor;

  return null;
end;
$$;

create trigger notify_task_status after update of status on public.tasks
  for each row execute function private.notify_task_status();

revoke all on function private.validate_project_client(), private.notify_task_status() from public, anon, authenticated;
