-- =============================================================================
-- 008: Individuals create fuller self-assigned tasks
--
-- Until now an INDIVIDUAL could only insert top-level tasks into the General
-- project. They may now also:
--   * add a task to any project they can already see (client work they are on);
--   * add subtasks under tasks they created themselves.
-- Assignment is unchanged: individuals still self-assign only
-- ("task_assignees: individuals self-assign their own tasks"), and admins /
-- super admins keep their existing policies.
-- =============================================================================

-- Projects an INDIVIDUAL may add their own tasks to: the General project, or a
-- project they own/created or already have an accessible task in.
create or replace function private.can_add_own_task_to_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and private.is_workspace_member(p.workspace_id)
      and p.status not in ('COMPLETED', 'ARCHIVED')
      and (
        p.is_default
        or p.owner_id = (select auth.uid())
        or p.created_by = (select auth.uid())
        or exists (
          select 1 from public.tasks t
          where t.project_id = p.id and t.id in (select private.accessible_task_ids())
        )
      )
  )
$$;

revoke all on function private.can_add_own_task_to_project(uuid) from public, anon;
grant execute on function private.can_add_own_task_to_project(uuid) to authenticated;

drop policy "tasks: individuals create own tasks in the General project" on public.tasks;

create policy "tasks: individuals create their own tasks"
  on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.current_user_role()) = 'INDIVIDUAL'
    and (
      (parent_task_id is null and private.can_add_own_task_to_project(project_id))
      -- subtasks only under their own tasks (same-project rule enforced by trigger)
      or (parent_task_id is not null and private.is_own_created_task(parent_task_id))
    )
  );
