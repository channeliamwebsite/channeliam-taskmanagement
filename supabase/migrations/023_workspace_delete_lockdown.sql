-- =============================================================================
-- 023_workspace_delete_lockdown.sql   (permission tightening; no data changes)
--
-- "workspaces: super admins can delete" (002) let any super admin of a
-- workspace delete it through the database API. The app has no such feature,
-- and the deletion cascades to everything in the workspace (001): its tasks,
-- daily reports, time entries and memberships, and its activity log entries,
-- including the admin audit trail (017). A super admin could therefore erase
-- the record of their own actions and their employees' history in one call,
-- bypassing the retention rules of 016.
--
-- The policy is removed, so signed-in users can no longer delete workspaces.
-- Deleting a workspace remains possible as a deliberate operation without a
-- user (service role / SQL editor), where the existing cascades still apply.
-- The DELETE grant stays; with RLS enabled and no DELETE policy, every
-- signed-in delete is filtered to 0 rows. Nothing else changes.
-- =============================================================================

drop policy "workspaces: super admins can delete" on public.workspaces;
