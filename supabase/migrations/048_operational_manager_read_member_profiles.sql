-- =============================================================================
-- 048_operational_manager_read_member_profiles.sql
--
-- Phase 2 (personal workspaces). Found during final UI verification: the
-- assignee picker showed "No active members in this workspace" for an
-- Operational Manager viewing a department workspace they aren't a member
-- of, even after 047 gave them read access to workspace_members rows there.
-- The member list also joins public.profiles, and "profiles: read self and
-- workspace peers" (002) / "profiles: company admins read all" (025) follow
-- the same "Super Admin bypass OR shared workspace" shape that 047 already
-- had to work around for workspaces/projects/tasks -- profiles was simply
-- the one place that pattern hadn't been found yet.
--
-- Added as a new, additive policy (existing ones are untouched) so it only
-- ever surfaces members of a department (non-personal) workspace -- an
-- Operational Manager still cannot see another manager's personal-workspace
-- membership this way, consistent with 047's isolation guarantee.
-- =============================================================================

create policy "profiles: operational managers read department members"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.user_id = profiles.id
        and private.is_operational_manager_in_department(wm.workspace_id)
    )
  );
