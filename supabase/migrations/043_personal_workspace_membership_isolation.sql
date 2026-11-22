-- =============================================================================
-- 043_personal_workspace_membership_isolation.sql
--
-- Phase 2 (personal workspaces). A personal workspace must always contain
-- exactly its Operational Manager owner as its sole member — through every
-- mutation path, not just the ordinary authenticated-client one.
--
-- An INSERT policy alone is not sufficient: supabase/seed.sql and two dev
-- test scripts (scripts/test-morning-report-race.mjs,
-- scripts/test-guard-races.mjs) already write workspaces/workspace_members
-- directly via service-role/raw SQL, which bypasses RLS entirely. The
-- trigger below is the real invariant — it fires on every INSERT, UPDATE and
-- DELETE against workspace_members regardless of which role performed the
-- write, and also blocks moving the owner's row INTO or OUT OF a personal
-- workspace via UPDATE (checking both OLD and NEW workspace_id). The RLS
-- policy patch below remains the first line of defense for ordinary
-- authenticated/PostgREST traffic.
--
-- Cascade behaviour (verified against the schema, not assumed): the
-- workspace_members.workspace_id FK is "on delete cascade" (001), and 023
-- already removed the only authenticated-facing DELETE policy on
-- workspaces, so a signed-in user can never hard-delete a workspace at all.
-- A service-role/SQL-editor delete of the workspace row itself still
-- cascades normally: by the time this trigger's SELECT against workspaces
-- runs for the cascaded workspace_members delete, the parent row is already
-- gone within that same transaction (standard Postgres MVCC/command-counter
-- semantics), so v_old_is_personal is null and the guard does not fire.
-- =============================================================================

create or replace function private.enforce_personal_workspace_single_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_is_personal boolean;
  v_new_owner uuid;
  v_old_is_personal boolean;
  v_old_owner uuid;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select is_personal, created_by into v_new_is_personal, v_new_owner
    from public.workspaces where id = new.workspace_id;

    if v_new_is_personal then
      if new.user_id is distinct from v_new_owner then
        raise exception 'A personal workspace may only contain its Operational Manager owner';
      end if;
      if exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = new.workspace_id and wm.id is distinct from new.id
      ) then
        raise exception 'This personal workspace already has its sole member';
      end if;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select is_personal, created_by into v_old_is_personal, v_old_owner
    from public.workspaces where id = old.workspace_id;

    if v_old_is_personal and old.user_id = v_old_owner then
      if tg_op = 'DELETE' then
        raise exception 'The Operational Manager owner cannot be removed from their personal workspace';
      end if;
      if new.workspace_id is distinct from old.workspace_id or new.user_id is distinct from old.user_id then
        raise exception 'The owner''s membership cannot be moved out of their personal workspace';
      end if;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists enforce_personal_workspace_single_member on public.workspace_members;
create trigger enforce_personal_workspace_single_member
  before insert or update or delete on public.workspace_members
  for each row execute function private.enforce_personal_workspace_single_member();

-- Belt-and-suspenders against a service-role/direct-SQL flip of the flag
-- itself (the UPDATE column grant already excludes is_personal/created_by
-- for the authenticated role, but grants don't constrain service_role).
create or replace function private.enforce_workspace_immutable_personal_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_personal is distinct from old.is_personal then
    raise exception 'workspaces.is_personal cannot be changed after creation';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'workspaces.created_by cannot be changed after creation';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_workspace_immutable_personal_flag on public.workspaces;
create trigger enforce_workspace_immutable_personal_flag
  before update on public.workspaces
  for each row execute function private.enforce_workspace_immutable_personal_flag();

-- First line of defense for ordinary authenticated/PostgREST traffic: a
-- Super Admin may still add department members, but never into a personal
-- workspace.
drop policy "workspace_members: super admins can add" on public.workspace_members;
create policy "workspace_members: super admins can add"
  on public.workspace_members for insert to authenticated
  with check (
    private.is_workspace_super_admin(workspace_id)
    and not coalesce((select is_personal from public.workspaces w where w.id = workspace_id), false)
  );
