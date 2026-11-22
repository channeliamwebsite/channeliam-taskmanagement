-- =============================================================================
-- 046_super_admin_monitoring_only.sql
--
-- Phase 2 (personal workspaces). Super Admin becomes monitoring-only: no
-- task or project creation, assignment, editing, deletion, personal tasks,
-- or task moderation (dependencies, other people's comments/attachments).
-- Every company-wide READ path (workspaces/tasks/projects SELECT,
-- attendance, leave, daily reports, client/project reports and exports) is
-- untouched by this migration — only write/moderation paths are narrowed.
--
-- can_manage_task is edited directly here, not duplicated into a new
-- function: after 044/045 moved task create/assign/edit/delete off it, its
-- only remaining callers are task_dependencies (create/update/delete),
-- task_comments (delete-others), task_attachments (delete-others), the
-- validate_task field-edit-scope check (045, already OR'd with a separate
-- function), validate_task_parent_access (018/044, subtask guard), and two
-- RPCs (006/022, reassignment helpers that are no longer reachable by Super
-- Admin's old blanket branch regardless). Removing is_company_admin() here
-- removes Super Admin from all of these in one well-scoped edit; Admin's
-- branch is copied verbatim (unchanged), and Operational Manager is not
-- referenced here at all, so none of this is granted to Operational Manager.
-- =============================================================================

create or replace function private.can_manage_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.projects pr on pr.id = t.project_id
    where t.id = p_task_id
      and private.is_workspace_member(t.workspace_id)
      and private.current_user_role() = 'ADMIN'
      and (
        t.created_by = (select auth.uid())
        or pr.owner_id = (select auth.uid())
        or pr.created_by = (select auth.uid())
        or exists (
          select 1 from public.task_assignees ta
          where ta.task_id = t.id
            and (ta.user_id = (select auth.uid()) or ta.assigned_by = (select auth.uid()))
        )
      )
  )
$$;

-- projects: Super Admin removed from update; Admin's existing
-- ownership/flag-based branch is unchanged.
drop policy "projects: super admins and managing admins can update" on public.projects;
create policy "projects: managing admins can update"
  on public.projects for update to authenticated
  using (
    private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[])
    and (
      owner_id = (select auth.uid())
      or created_by = (select auth.uid())
      or (not is_default and private.can_create_project(workspace_id))
    )
  )
  with check (
    private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[])
  );

-- projects: Super Admin was the only role that could ever hard-delete a
-- project. Dropped with no replacement, consistent with the existing
-- "archive, not delete" precedent (023, 027) elsewhere in this schema; no
-- other role gains project deletion.
drop policy "projects: super admins can delete" on public.projects;
