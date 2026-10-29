-- =============================================================================
-- 019_admin_client_delete.sql   (permission change: one added policy)
--
-- Role correction: admins run day-to-day client work, so admins of a
-- workspace may now delete that workspace's clients, as super admins already
-- could ("clients: super admins can delete", 004 — kept unchanged).
--
-- Data integrity is unchanged: a client that still has projects cannot be
-- deleted (projects_client_id_fkey ON DELETE NO ACTION, 014), and deletions
-- are recorded in the activity log (CLIENT_DELETED, 017). Individuals and
-- members of other workspaces still cannot delete clients. The DELETE grant on
-- clients already exists (004); no other policy or grant changes.
-- =============================================================================

create policy "clients: admins can delete"
  on public.clients for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[]));
