-- =============================================================================
-- 020_admin_project_management.sql   (permission change; no data changes)
--
-- Role correction: admins run day-to-day project work.
--
-- 1. Project creation is ON by default for new memberships.
--    workspace_members.can_create_projects stays the per-workspace switch that
--    super admins use to restrict an admin (Team -> "Disallow creating
--    projects"); only its default changes from false to true. The rule itself
--    is unchanged (private.can_create_project, 002): super admins of the
--    workspace, or admins whose membership has the flag. Individuals and
--    non-members still cannot create projects.
--
--    Existing memberships are NOT changed: an existing false may be a
--    deliberate restriction, and this migration cannot tell it apart from the
--    old default. To turn creation on for every current admin after review:
--      update public.workspace_members wm set can_create_projects = true
--      from public.profiles p
--      where p.id = wm.user_id and p.role = 'ADMIN' and not wm.can_create_projects;
--    (The admin audit trail, 017, records each change made by a signed-in
--    super admin through the app; run from the SQL editor it has no actor.)
--
-- 2. Admins who may manage projects in a workspace (the same flag) may edit
--    any of its projects except the default General project, including ones a
--    super admin created. Owners and creators keep editing their own projects
--    as before; super admins are unchanged. The WITH CHECK clause is
--    unchanged, and validate_project (003) still stops a project moving to
--    another workspace; validate_project_client (004) still requires a same-workspace
--    client.
--
-- Unchanged: project deletion (super admins only, 002; General protected by
-- 006), client deletion rules (014, 019), the subtask guard (018), RLS on
-- every other table, and column grants.
-- =============================================================================

alter table public.workspace_members alter column can_create_projects set default true;

drop policy "projects: super admins and owning admins can update" on public.projects;

create policy "projects: super admins and managing admins can update"
  on public.projects for update to authenticated
  using (
    private.is_workspace_super_admin(workspace_id)
    or (
      private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[])
      and (
        owner_id = (select auth.uid())
        or created_by = (select auth.uid())
        or (not is_default and private.can_create_project(workspace_id))
      )
    )
  )
  with check (
    private.is_workspace_super_admin(workspace_id)
    or private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[])
  );
