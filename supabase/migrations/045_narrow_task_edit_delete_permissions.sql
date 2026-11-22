-- =============================================================================
-- 045_narrow_task_edit_delete_permissions.sql
--
-- Phase 2 (personal workspaces). Admin keeps today's full ownership-based
-- edit/delete rights, unchanged. Operational Manager may edit/delete only
-- tasks they personally created. Super Admin has no branch here
-- (monitoring-only).
-- =============================================================================

create or replace function private.can_edit_or_delete_own_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t join public.projects pr on pr.id = t.project_id
    where t.id = p_task_id and (
      (private.current_user_role() = 'OPERATIONAL_MANAGER' and t.created_by = (select auth.uid()))
      or (
        private.is_workspace_member(t.workspace_id)
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
    )
  )
$$;

drop policy "tasks: managers and assignees can update" on public.tasks;
create policy "tasks: authorised editors and assignees can update"
  on public.tasks for update to authenticated
  using (private.can_edit_or_delete_own_task(id) or private.is_task_assignee(id))
  with check (private.can_edit_or_delete_own_task(id) or private.is_task_assignee(id));

drop policy "tasks: super admins and creators can delete" on public.tasks;
create policy "tasks: creators can delete their own tasks"
  on public.tasks for delete to authenticated
  using (created_by = (select auth.uid()) and private.can_edit_or_delete_own_task(id));

-- validate_task (003): the full-edit-vs-status/progress-only gate checked
-- only can_manage_task, which (046) stays Admin-only on purpose so it never
-- leaks dependency/comment/attachment rights to Operational Manager. Without
-- this change, an Operational Manager editing a task they created would be
-- wrongly restricted to status/progress only. Reproduced in full from the
-- live 003 definition with only line 203's condition changed; the parent-task
-- and cycle-check logic below is untouched, byte-for-byte.
create or replace function private.validate_task()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_parent_project uuid;
begin
  if tg_op = 'INSERT' then
    select pr.workspace_id into new.workspace_id
    from public.projects pr where pr.id = new.project_id;
  else
    if new.project_id is distinct from old.project_id then
      raise exception 'A task cannot be moved to another project' using errcode = '23514';
    end if;
    new.workspace_id := old.workspace_id;

    -- Top-level client updates by non-managers (INDIVIDUAL assignees) may only
    -- touch status and progress. Nested trigger updates (e.g. actual_hours
    -- sync) and trusted server calls are exempt.
    if pg_trigger_depth() = 1
       and (select auth.uid()) is not null
       and not (private.can_manage_task(old.id) or private.can_edit_or_delete_own_task(old.id))
       and (new.parent_task_id, new.title, new.description, new.priority, new.task_type,
            new.start_date, new.due_date, new.estimated_hours, new.actual_hours, new.created_by)
           is distinct from
           (old.parent_task_id, old.title, old.description, old.priority, old.task_type,
            old.start_date, old.due_date, old.estimated_hours, old.actual_hours, old.created_by) then
      raise exception 'Assignees without manage rights may only update status and progress'
        using errcode = '42501';
    end if;
  end if;

  if new.parent_task_id is not null
     and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id) then
    select t.project_id into v_parent_project
    from public.tasks t where t.id = new.parent_task_id;

    if v_parent_project is distinct from new.project_id then
      raise exception 'Parent task must belong to the same project' using errcode = '23514';
    end if;

    -- Reject cycles: the new parent must not be this task or one of its descendants.
    if tg_op = 'UPDATE' and exists (
      with recursive ancestors as (
        select new.parent_task_id as id
        union
        select t.parent_task_id
        from public.tasks t join ancestors a on t.id = a.id
        where t.parent_task_id is not null
      )
      select 1 from ancestors where id = new.id
    ) then
      raise exception 'Task hierarchy cannot contain cycles' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
