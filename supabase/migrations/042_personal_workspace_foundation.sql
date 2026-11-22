-- =============================================================================
-- 042_personal_workspace_foundation.sql   (new column + Super Admin provisioning)
--
-- Phase 2 (personal workspaces). Adds workspaces.is_personal and the one
-- controlled path that may ever set it: private.provision_personal_workspace,
-- callable only by a Super Admin, only for an OPERATIONAL_MANAGER target.
--
-- Deliberately no new general INSERT policy on workspaces for is_personal =
-- true: the column is created, has_workspace_role et al still don't know
-- about it, and the only way to get a personal workspace row at all is
-- through this function (SECURITY DEFINER, bypasses RLS the same way
-- add_workspace_creator already does). created_by and is_personal are never
-- added to the "workspaces" UPDATE column grant (002: only name, description
-- are grantable), so both are immutable after creation by construction, with
-- no trigger required for that part.
-- =============================================================================

alter table public.workspaces
  add column is_personal boolean not null default false;

-- One personal workspace per Operational Manager.
create unique index workspaces_personal_creator_uidx
  on public.workspaces (created_by)
  where is_personal;

-- The existing Super Admin creation path is department workspaces only.
drop policy "workspaces: super admins can create" on public.workspaces;
create policy "workspaces: super admins can create"
  on public.workspaces for insert to authenticated
  with check (private.current_user_role() = 'SUPER_ADMIN' and is_personal = false);

create or replace function private.provision_personal_workspace(
  p_operational_manager_id uuid,
  p_name text default 'Personal Workspace'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_workspace_id uuid;
begin
  if private.current_user_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'Only a Super Admin may provision a personal workspace';
  end if;

  select role into v_role from public.profiles where id = p_operational_manager_id;
  if v_role is distinct from 'OPERATIONAL_MANAGER' then
    raise exception 'Target user is not an Operational Manager';
  end if;

  if exists (
    select 1 from public.workspaces
    where created_by = p_operational_manager_id and is_personal
  ) then
    raise exception 'This Operational Manager already has a personal workspace';
  end if;

  insert into public.workspaces (name, is_personal, created_by)
  values (coalesce(p_name, 'Personal Workspace'), true, p_operational_manager_id)
  returning id into v_workspace_id;

  return v_workspace_id;
end;
$$;

revoke all on function private.provision_personal_workspace(uuid, text) from public;
grant execute on function private.provision_personal_workspace(uuid, text) to authenticated;
