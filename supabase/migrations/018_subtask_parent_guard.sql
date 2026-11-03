-- =============================================================================
-- 018_subtask_parent_guard.sql   (new guard; no data or permission changes)
--
-- Security fix (audit M1). The admin insert policy on tasks ("tasks: admins
-- create in their workspace projects", 002) checks the project but not the
-- parent task, and validate_task (003) only requires the parent to be in the
-- same project. An admin who knew a task id could therefore add a subtask
-- under a task they cannot manage, and through accessible_task_ids (004:
-- ancestors of visible tasks are visible) read that parent, its assignees and
-- comments, and change its progress (parents count through their subtasks).
--
-- Rule now enforced for every signed-in caller, on insert and whenever
-- parent_task_id changes: the caller must manage the parent
-- (private.can_manage_task: super admins of the workspace; admins who
-- created it, own or created its project, are assigned to it or assigned
-- someone to it), or be an INDIVIDUAL nesting under a task they created
-- themselves (unchanged rule from 006/008).
--
-- Not changed: the assigned-admin rule inside can_manage_task (audit M2),
-- RLS policies, grants, validate_task, and calls without a user (service
-- role, SQL editor, scheduled jobs), which stay trusted like elsewhere.
-- can_manage_task and is_own_created_task are SECURITY DEFINER and read
-- tasks directly, so this adds no RLS recursion.
-- =============================================================================

create or replace function private.validate_task_parent_access()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.parent_task_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_task_id is not distinct from old.parent_task_id then
    return new;
  end if;
  if private.can_manage_task(new.parent_task_id)
     or (private.current_user_role() = 'INDIVIDUAL' and private.is_own_created_task(new.parent_task_id)) then
    return new;
  end if;
  raise exception 'You can only add subtasks to tasks you manage.' using errcode = '42501';
end;
$$;

create trigger validate_task_parent_access before insert or update of parent_task_id on public.tasks
  for each row execute function private.validate_task_parent_access();

-- Trigger functions are not meant to be called directly.
revoke all on function private.validate_task_parent_access() from public, anon, authenticated;
