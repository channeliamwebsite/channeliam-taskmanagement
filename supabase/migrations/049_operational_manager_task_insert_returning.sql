-- =============================================================================
-- 049_operational_manager_task_insert_returning.sql
--
-- Phase 2 (personal workspaces). Found during final UI verification:
-- creating a task as an Operational Manager in a department workspace they
-- are not a member of failed with "new row violates row-level security
-- policy for table tasks", even though 044 already lets them create and
-- 047 already lets them read it a moment later.
--
-- Root cause: Postgres requires a row inserted with RETURNING to also pass
-- the table's SELECT policy, evaluated as part of the SAME command as the
-- INSERT. "tasks: read accessible" (002) already has a fallback branch for
-- exactly this ("lets INSERT ... RETURNING see the row it just created")
-- that deliberately avoids accessible_task_ids()'s recursive CTE -- a
-- self-just-inserted row is not reliably visible to that recursive query
-- within the same command, only to a later, separate one (confirmed
-- directly: the plain INSERT succeeds, and a SEPARATE subsequent SELECT via
-- accessible_task_ids() sees the row fine; only INSERT ... RETURNING fails).
-- The existing fallback only covers members of the workspace, so it never
-- covered an Operational Manager creating in a department workspace they
-- don't belong to. This is the same bug class as 047/048, just on the one
-- remaining read path those two didn't reach: "can I see what I just
-- inserted, within the INSERT itself."
-- =============================================================================

drop policy "tasks: read accessible" on public.tasks;
create policy "tasks: read accessible"
  on public.tasks for select to authenticated
  using (
    id in (select private.accessible_task_ids())
    -- lets INSERT ... RETURNING see the row it just created
    or (created_by = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()))
    or (
      created_by = (select auth.uid())
      and private.current_user_role() = 'OPERATIONAL_MANAGER'
      and exists (select 1 from public.workspaces w where w.id = workspace_id and not w.is_personal)
    )
  );
