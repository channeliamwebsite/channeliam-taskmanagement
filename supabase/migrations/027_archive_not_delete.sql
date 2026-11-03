-- =============================================================================
-- 027_archive_not_delete.sql   (data protection: deletion guards; no data or
-- permission changes)
--
-- Decided 2026-10-30: projects that contain tasks are archived, not deleted,
-- and tasks with history are cancelled, not deleted, so task history,
-- subtasks, comments, assignments and report references survive.
--
-- Until now deleting a project cascaded to all of its tasks (001,
-- tasks.project_id ON DELETE CASCADE) together with their subtasks, comments,
-- time entries, attachments and assignments, and deleting a task removed its
-- subtasks and their data in the same way. Daily reports (planned_task_ids,
-- linked_task_ids, snapshots) and meeting follow-ups keep task ids without a
-- foreign key, so those references silently pointed at nothing.
--
-- 1. Projects: tasks.project_id becomes ON DELETE NO ACTION (as clients ->
--    projects in 014), and a BEFORE DELETE trigger explains the refusal:
--    "This project has tasks. Archive it instead of deleting it." An empty
--    project can still be deleted. Deleting a whole workspace (only possible
--    without a signed-in user since 023) still removes its projects and tasks:
--    the check runs at the end of the statement, when both are gone.
-- 2. Tasks: a BEFORE DELETE trigger refuses deleting a task that has history:
--    subtasks, comments, time entries, attachments, a mention in a daily
--    report (planned or linked ids, morning or evening snapshot) or a meeting
--    follow-up. Cancelling (status CANCELLED) is the way to retire it. A task
--    created by mistake, with none of that, can still be deleted by those
--    allowed to (unchanged RLS). Calls without a signed-in user (service role,
--    SQL editor, the 016 erasure procedure) are trusted as in 022, and
--    deletions caused by removing the whole workspace are not blocked.
-- 3. Archived projects take no new tasks, for any role (the Individual rule in
--    008 already refused COMPLETED and ARCHIVED projects).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Projects with tasks cannot be deleted
-- -----------------------------------------------------------------------------
alter table public.tasks drop constraint tasks_project_id_fkey;
alter table public.tasks
  add constraint tasks_project_id_fkey foreign key (project_id)
  references public.projects (id) on delete no action;

create or replace function private.protect_project_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Removing the whole workspace: the workspace row is already gone.
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  if exists (select 1 from public.tasks t where t.project_id = old.id) then
    raise exception 'This project has tasks. Archive it instead of deleting it.' using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger protect_project_history before delete on public.projects
  for each row execute function private.protect_project_history();

-- -----------------------------------------------------------------------------
-- 2. Tasks with history cannot be deleted
-- -----------------------------------------------------------------------------
create or replace function private.task_has_history(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.tasks s where s.parent_task_id = p_task_id)
      or exists (select 1 from public.task_comments c where c.task_id = p_task_id)
      or exists (select 1 from public.time_entries e where e.task_id = p_task_id)
      or exists (select 1 from public.task_attachments a where a.task_id = p_task_id)
      or exists (
        select 1 from public.daily_reports r
        where p_task_id = any (r.planned_task_ids)
           or p_task_id = any (r.linked_task_ids)
           or r.evening_snapshot -> 'tasks' @> jsonb_build_array(jsonb_build_object('id', p_task_id))
           or r.morning_snapshot -> 'tasks' @> jsonb_build_array(jsonb_build_object('id', p_task_id))
      )
      or exists (select 1 from public.meeting_records m where p_task_id = any (m.follow_up_task_ids))
$$;

create or replace function private.protect_task_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Trusted calls without a signed-in user, and removal of the whole workspace.
  if (select auth.uid()) is null
     or not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  if private.task_has_history(old.id) then
    raise exception 'This task has history (subtasks, comments, time, attachments, reports or meeting follow-ups). Cancel it instead of deleting it.'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger protect_task_history before delete on public.tasks
  for each row execute function private.protect_task_history();

-- -----------------------------------------------------------------------------
-- 3. No new tasks in archived projects (same as 002 otherwise)
-- -----------------------------------------------------------------------------
create or replace function private.can_create_task_in_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p_project_id
      and pr.status <> 'ARCHIVED'
      and private.has_workspace_role(pr.workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[])
  )
$$;

revoke all on function private.protect_project_history(), private.protect_task_history() from public, anon, authenticated;
revoke all on function private.task_has_history(uuid) from public, anon;
grant execute on function private.task_has_history(uuid) to authenticated;
