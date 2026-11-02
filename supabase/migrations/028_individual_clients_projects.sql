-- =============================================================================
-- 028_individual_clients_projects.sql   (permission change: a new, default-off
-- per-workspace grant lets Individuals create clients and projects)
--
-- Decided 2026-10-30 (option a): Individuals may create clients and projects in
-- a workspace only when a super admin has explicitly granted them the new
-- workspace_members.can_create_clients_projects flag. It defaults to false and
-- every existing membership starts without it, so nobody gains a permission by
-- this migration. The existing can_create_projects flag (admins, 002/020,
-- default true since 020) is not used for this and is unchanged.
--
-- An INDIVIDUAL member with the grant may:
--   * create clients in that workspace, and edit the clients they created;
--   * create projects in that workspace (clients of that workspace only, 004
--     trigger), and edit the projects they created, except archiving them.
-- They still cannot delete clients or projects, assign work to other people
-- (self-assignment only, 006/008) or see other people's tasks; they add their
-- own tasks to projects they created (008: created_by).
--
-- Granting and revoking: super admins only, through the existing
-- "workspace_members: super admins can update" policy (002, company-wide since
-- 025) and a new column grant. Changes are audited as
-- MEMBER_PERMISSION_CHANGED (017 trigger extended below). The grant is
-- meaningful only for INDIVIDUAL members; for other roles it has no effect.
-- ADMIN and SUPER_ADMIN rules are unchanged.
-- =============================================================================

alter table public.workspace_members
  add column if not exists can_create_clients_projects boolean not null default false;
comment on column public.workspace_members.can_create_clients_projects is
  'Individuals only: may create clients and projects in this workspace (028). Default off; granted by a super admin.';
grant update (can_create_clients_projects) on public.workspace_members to authenticated;

-- An active INDIVIDUAL member of the workspace holding the grant.
create or replace function private.individual_may_create(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.current_user_role() = 'INDIVIDUAL'
     and exists (
       select 1 from public.workspace_members wm
       where wm.workspace_id = p_workspace_id
         and wm.user_id = (select auth.uid())
         and wm.can_create_clients_projects
     )
$$;

-- Same as 002 (with 025's company-level super admin), plus the Individual grant.
create or replace function private.can_create_project(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_workspace_super_admin(p_workspace_id)
      or (
        private.current_user_role() = 'ADMIN'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = p_workspace_id
            and wm.user_id = (select auth.uid())
            and wm.can_create_projects
        )
      )
      or private.individual_may_create(p_workspace_id)
$$;

-- Clients
drop policy if exists "clients: granted individuals create" on public.clients;
create policy "clients: granted individuals create"
  on public.clients for insert to authenticated
  with check (created_by = (select auth.uid()) and private.individual_may_create(workspace_id));

drop policy if exists "clients: individuals edit the clients they created" on public.clients;
create policy "clients: individuals edit the clients they created"
  on public.clients for update to authenticated
  using (
    created_by = (select auth.uid())
    and (select private.current_user_role()) = 'INDIVIDUAL'
    and private.is_workspace_member(workspace_id)
  )
  with check (
    created_by = (select auth.uid())
    and (select private.current_user_role()) = 'INDIVIDUAL'
    and private.is_workspace_member(workspace_id)
  );

-- Projects: creation goes through "projects: permitted users can create" (002,
-- private.can_create_project above). Individuals edit their own, not archive.
drop policy if exists "projects: individuals edit the projects they created" on public.projects;
create policy "projects: individuals edit the projects they created"
  on public.projects for update to authenticated
  using (
    created_by = (select auth.uid())
    and (select private.current_user_role()) = 'INDIVIDUAL'
    and private.is_workspace_member(workspace_id)
  )
  with check (
    created_by = (select auth.uid())
    and (select private.current_user_role()) = 'INDIVIDUAL'
    and private.is_workspace_member(workspace_id)
    and status <> 'ARCHIVED'
  );

-- An individual's project is owned by themselves or nobody: ownership carries
-- task visibility (002), so it cannot be handed to someone else.
drop policy if exists "projects: individuals own only their own projects" on public.projects;
create policy "projects: individuals own only their own projects"
  on public.projects as restrictive for insert to authenticated
  with check (
    (select private.current_user_role()) is distinct from 'INDIVIDUAL'
    or owner_id is null
    or owner_id = (select auth.uid())
  );
drop policy if exists "projects: individuals keep ownership with themselves" on public.projects;
create policy "projects: individuals keep ownership with themselves"
  on public.projects as restrictive for update to authenticated
  using (
    (select private.current_user_role()) is distinct from 'INDIVIDUAL'
    or owner_id is null
    or owner_id = (select auth.uid())
  )
  with check (
    (select private.current_user_role()) is distinct from 'INDIVIDUAL'
    or owner_id is null
    or owner_id = (select auth.uid())
  );

-- Audit: as 017, plus the new grant.
create or replace function private.log_member_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(new.workspace_id, null, new.user_id, 'MEMBER_ADDED', null,
      jsonb_build_object('can_create_projects', new.can_create_projects,
                         'can_create_clients_projects', new.can_create_clients_projects));
  elsif tg_op = 'DELETE' then
    -- Cascades from a deleted workspace or profile: nothing left to reference.
    if not exists (select 1 from public.workspaces where id = old.workspace_id)
       or not exists (select 1 from public.profiles where id = old.user_id) then
      return null;
    end if;
    perform private.log_audit(old.workspace_id, null, old.user_id, 'MEMBER_REMOVED');
  else
    if new.can_create_projects is distinct from old.can_create_projects then
      perform private.log_audit(new.workspace_id, null, new.user_id, 'MEMBER_PERMISSION_CHANGED',
        jsonb_build_object('can_create_projects', old.can_create_projects),
        jsonb_build_object('can_create_projects', new.can_create_projects));
    end if;
    if new.can_create_clients_projects is distinct from old.can_create_clients_projects then
      perform private.log_audit(new.workspace_id, null, new.user_id, 'MEMBER_PERMISSION_CHANGED',
        jsonb_build_object('can_create_clients_projects', old.can_create_clients_projects),
        jsonb_build_object('can_create_clients_projects', new.can_create_clients_projects));
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.individual_may_create(uuid) from public, anon;
grant execute on function private.individual_may_create(uuid) to authenticated;
