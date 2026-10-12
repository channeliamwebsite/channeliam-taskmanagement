-- =============================================================================
-- 005_task_scheduling.sql   (additive, non-destructive)
--   * tasks.scheduled_date: the day work is planned (distinct from start_date
--     and due_date). Backfilled from start_date, which the UI labelled
--     "Scheduled date" until this migration; start_date itself is untouched.
--   * workspaces.timezone (default Asia/Kolkata) for "today" / carry-forward.
--   * scheduling changes are recorded in activity_logs (TASK_SCHEDULED).
--   Carry-forward itself is derived at read time (no rows are moved or
--   duplicated), so it is idempotent by construction.
-- =============================================================================

alter type public.activity_action add value if not exists 'TASK_SCHEDULED';

alter table public.tasks add column scheduled_date date;

update public.tasks
set scheduled_date = start_date
where scheduled_date is null and start_date is not null;

create index tasks_workspace_scheduled_idx on public.tasks (workspace_id, scheduled_date);
create index tasks_open_scheduled_idx on public.tasks (scheduled_date)
  where status not in ('COMPLETED', 'CANCELLED') and scheduled_date is not null;

-- Assignees may (re)schedule their own work: scheduled_date is not one of the
-- columns the existing validate_task guard restricts to managers.
grant update (scheduled_date) on public.tasks to authenticated;

alter table public.workspaces
  add column timezone text not null default 'Asia/Kolkata'
  check (char_length(timezone) between 1 and 64);

grant update (timezone) on public.workspaces to authenticated;

-- Same as 003's version, plus scheduled_date changes.
create or replace function private.log_task_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'TASK_CREATED', null,
      jsonb_build_object('title', new.title, 'status', new.status, 'priority', new.priority,
                         'parent_task_id', new.parent_task_id));
    return null;
  end if;

  if new.status is distinct from old.status then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'STATUS_CHANGED',
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
    if new.status = 'COMPLETED' then
      perform private.log_activity(new.workspace_id, new.id, new.project_id, 'TASK_COMPLETED', null, null);
    end if;
  end if;

  if new.priority is distinct from old.priority then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'PRIORITY_CHANGED',
      jsonb_build_object('priority', old.priority), jsonb_build_object('priority', new.priority));
  end if;

  if new.progress is distinct from old.progress then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'PROGRESS_CHANGED',
      jsonb_build_object('progress', old.progress), jsonb_build_object('progress', new.progress));
  end if;

  if new.due_date is distinct from old.due_date then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'DUE_DATE_CHANGED',
      jsonb_build_object('due_date', old.due_date), jsonb_build_object('due_date', new.due_date));
  end if;

  if new.scheduled_date is distinct from old.scheduled_date then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'TASK_SCHEDULED',
      jsonb_build_object('scheduled_date', old.scheduled_date), jsonb_build_object('scheduled_date', new.scheduled_date));
  end if;

  return null;
end;
$$;
