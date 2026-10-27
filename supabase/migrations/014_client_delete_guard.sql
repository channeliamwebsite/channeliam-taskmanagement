-- =============================================================================
-- 014: deleting a client never silently detaches its projects.
--
-- projects.client_id was ON DELETE SET NULL, so deleting a client quietly left
-- its projects without a client. The policy is now explicit: a client can be
-- deleted only once it has no projects (move or delete them first). NO ACTION
-- (checked at the end of the statement) rather than RESTRICT, so deleting a
-- whole workspace, which cascades to both clients and projects, still works.
--
-- No data changes. RLS is unchanged: only super admins of the workspace can
-- delete clients ("clients: super admins can delete").
-- =============================================================================

alter table public.projects drop constraint projects_client_id_fkey;
alter table public.projects
  add constraint projects_client_id_fkey foreign key (client_id)
  references public.clients (id) on delete no action;
