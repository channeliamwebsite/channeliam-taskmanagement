-- =============================================================================
-- 009_report_submission_functions.sql   (additive; existing rows unchanged)
--
-- Daily reports are submitted through two database functions that decide the
-- report date (workspace timezone), the first-submission times, the evening
-- task snapshot and the evening counts on the server:
--
--   public.submit_morning_plan(workspace, notes, planned task ids)
--   public.submit_evening_report(workspace, hours, texts..., linked task ids)
--
-- Task ids from the client are only a selection: anything that is not a task
-- in that workspace assigned to the caller is dropped, and titles, statuses
-- and completion data are read from the tasks table, never from the client.
--
-- Compatibility: direct INSERT/UPDATE by the current app keeps working after
-- this migration (only the new columns, id and the audit timestamps are
-- excluded from client inserts). Migration 010 removes direct writes once the
-- app uses these functions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New columns (nullable; no backfill — reports without a snapshot keep using
-- the live task lookup in the app)
-- -----------------------------------------------------------------------------
alter table public.daily_reports
  add column evening_snapshot jsonb
    check (evening_snapshot is null or jsonb_typeof(evening_snapshot) = 'object'),
  add column reporter_team text
    check (reporter_team is null or char_length(reporter_team) <= 100);

comment on column public.daily_reports.evening_snapshot is
  'Server-built at evening submission: {version, captured_at, timezone, reporter_team, tasks:[{id,title,status,priority,project_id,project_name,client_name,parent_task_id,scheduled_date,due_date,completed_at}]}';
comment on column public.daily_reports.reporter_team is
  'Employee department (profiles.team) at the first submission for that day.';

-- Client inserts may no longer set the new server-owned columns (nor id or the
-- created/updated timestamps). The columns listed are exactly those the current
-- app and tests insert; UPDATE grants are unchanged here and never covered the
-- new columns.
revoke insert on public.daily_reports from authenticated;
grant insert (user_id, workspace_id, report_date, tasks_completed, tasks_in_progress, tasks_blocked,
              total_hours, accomplishments, blockers, tomorrow_plan, work_remaining, linked_task_ids,
              morning_plan, planned_task_ids, morning_submitted_at, evening_submitted_at)
  on public.daily_reports to authenticated;

-- -----------------------------------------------------------------------------
-- Private helpers (called only from the submission functions below)
-- -----------------------------------------------------------------------------

-- The workspace's IANA timezone, or Asia/Kolkata when missing/invalid (same
-- fallback as private.set_task_schedule_default).
create or replace function private.workspace_timezone(p_workspace_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select w.timezone
     from public.workspaces w
     where w.id = p_workspace_id
       and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = w.timezone)),
    'Asia/Kolkata')
$$;

-- The calling user, who must be signed in, active and a member of the workspace.
create or replace function private.report_author(p_workspace_id uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_workspace_id is null or not private.is_active_workspace_member(p_workspace_id, v_uid) then
    raise exception 'Reports can only be submitted by active members of the workspace' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Trimmed text, NULL when blank; rejects text over the limit.
create or replace function private.report_text(p_value text, p_max integer)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := nullif(btrim(p_value), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception 'Text is longer than % characters', p_max using errcode = '22001';
  end if;
  return v;
end;
$$;

-- The subset of p_task_ids that are tasks in the workspace assigned to the
-- user, de-duplicated, in the order given, at most 100.
create or replace function private.own_report_task_ids(p_workspace_id uuid, p_user_id uuid, p_task_ids uuid[])
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(x.id order by x.ord), '{}')
  from (
    select i.id, min(i.ord) as ord
    from unnest(coalesce(p_task_ids, '{}'::uuid[])) with ordinality as i(id, ord)
    join public.tasks t on t.id = i.id and t.workspace_id = p_workspace_id
    where exists (select 1 from public.task_assignees ta where ta.task_id = t.id and ta.user_id = p_user_id)
    group by i.id
    order by min(i.ord)
    limit 100
  ) x
$$;

-- -----------------------------------------------------------------------------
-- Morning plan
-- -----------------------------------------------------------------------------
create or replace function public.submit_morning_plan(
  p_workspace_id uuid,
  p_notes text default null,
  p_planned_task_ids uuid[] default '{}'
)
returns date
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.report_author(p_workspace_id);
  v_date date := (now() at time zone private.workspace_timezone(p_workspace_id))::date;
  v_notes text := private.report_text(p_notes, 10000);
  v_ids uuid[] := private.own_report_task_ids(p_workspace_id, v_uid, p_planned_task_ids);
  v_team text;
begin
  select p.team into v_team from public.profiles p where p.id = v_uid;

  -- One row per user/workspace/day. Resubmitting replaces the plan but keeps
  -- the first submission time and the department recorded at that time.
  insert into public.daily_reports as r
    (user_id, workspace_id, report_date, morning_plan, planned_task_ids, morning_submitted_at, reporter_team)
  values
    (v_uid, p_workspace_id, v_date, v_notes, v_ids, now(), v_team)
  on conflict (user_id, workspace_id, report_date) do update
    set morning_plan         = excluded.morning_plan,
        planned_task_ids     = excluded.planned_task_ids,
        morning_submitted_at = coalesce(r.morning_submitted_at, excluded.morning_submitted_at),
        reporter_team        = coalesce(r.reporter_team, excluded.reporter_team);

  return v_date;
end;
$$;

-- -----------------------------------------------------------------------------
-- Evening report
-- -----------------------------------------------------------------------------
create or replace function public.submit_evening_report(
  p_workspace_id uuid,
  p_total_hours numeric default 0,
  p_accomplishments text default null,
  p_work_remaining text default null,
  p_blockers text default null,
  p_tomorrow_plan text default null,
  p_linked_task_ids uuid[] default '{}'
)
returns date
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.report_author(p_workspace_id);
  v_tz text := private.workspace_timezone(p_workspace_id);
  v_date date := (now() at time zone v_tz)::date;
  v_ids uuid[] := private.own_report_task_ids(p_workspace_id, v_uid, p_linked_task_ids);
  v_hours numeric := coalesce(p_total_hours, 0);
  v_team text;
  v_tasks jsonb;
  v_done integer;
  v_open integer;
  v_blocked integer;
begin
  if v_hours < 0 or v_hours > 24 then
    raise exception 'Hours must be between 0 and 24' using errcode = '22023';
  end if;

  select p.team into v_team from public.profiles p where p.id = v_uid;

  -- Snapshot of the reported tasks as they are now (read from the database).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'title', t.title,
           'status', t.status,
           'priority', t.priority,
           'project_id', t.project_id,
           'project_name', pr.name,
           'client_name', coalesce(c.name, pr.client_name),
           'parent_task_id', t.parent_task_id,
           'scheduled_date', t.scheduled_date,
           'due_date', t.due_date,
           'completed_at', t.completed_at
         ) order by i.ord), '[]'::jsonb)
  into v_tasks
  from unnest(v_ids) with ordinality as i(id, ord)
  join public.tasks t on t.id = i.id
  join public.projects pr on pr.id = t.project_id
  left join public.clients c on c.id = pr.client_id;

  -- Counts follow the app's evening-report meaning — completed today, still
  -- open (not blocked) and blocked — and are taken from the snapshot itself,
  -- so the stored counts always agree with the stored tasks.
  select count(*) filter (where e ->> 'status' = 'COMPLETED'
                            and ((e ->> 'completed_at')::timestamptz at time zone v_tz)::date = v_date),
         count(*) filter (where e ->> 'status' not in ('COMPLETED', 'CANCELLED', 'BLOCKED')),
         count(*) filter (where e ->> 'status' = 'BLOCKED')
  into v_done, v_open, v_blocked
  from jsonb_array_elements(v_tasks) as e;

  insert into public.daily_reports as r
    (user_id, workspace_id, report_date, tasks_completed, tasks_in_progress, tasks_blocked, total_hours,
     accomplishments, work_remaining, blockers, tomorrow_plan, linked_task_ids,
     evening_submitted_at, evening_snapshot, reporter_team)
  values
    (v_uid, p_workspace_id, v_date, v_done, v_open, v_blocked, round(v_hours, 2),
     private.report_text(p_accomplishments, 10000), private.report_text(p_work_remaining, 10000),
     private.report_text(p_blockers, 10000), private.report_text(p_tomorrow_plan, 10000), v_ids,
     now(),
     jsonb_build_object('version', 1, 'captured_at', now(), 'timezone', v_tz, 'reporter_team', v_team, 'tasks', v_tasks),
     v_team)
  -- Resubmitting the same day replaces the content and the snapshot, but keeps
  -- the first submission time and the department recorded at that time.
  on conflict (user_id, workspace_id, report_date) do update
    set tasks_completed      = excluded.tasks_completed,
        tasks_in_progress    = excluded.tasks_in_progress,
        tasks_blocked        = excluded.tasks_blocked,
        total_hours          = excluded.total_hours,
        accomplishments      = excluded.accomplishments,
        work_remaining       = excluded.work_remaining,
        blockers             = excluded.blockers,
        tomorrow_plan        = excluded.tomorrow_plan,
        linked_task_ids      = excluded.linked_task_ids,
        evening_snapshot     = excluded.evening_snapshot,
        evening_submitted_at = coalesce(r.evening_submitted_at, excluded.evening_submitted_at),
        reporter_team        = coalesce(r.reporter_team, excluded.reporter_team);

  return v_date;
end;
$$;

-- -----------------------------------------------------------------------------
-- Execute privileges: helpers are internal; only signed-in users may submit.
-- (New functions are executable by PUBLIC by default, and Supabase also grants
-- anon — both are revoked explicitly.)
-- -----------------------------------------------------------------------------
revoke all on function
  private.workspace_timezone(uuid),
  private.report_author(uuid),
  private.report_text(text, integer),
  private.own_report_task_ids(uuid, uuid, uuid[])
from public, anon, authenticated;

revoke all on function
  public.submit_morning_plan(uuid, text, uuid[]),
  public.submit_evening_report(uuid, numeric, text, text, text, text, uuid[])
from public, anon;

grant execute on function
  public.submit_morning_plan(uuid, text, uuid[]),
  public.submit_evening_report(uuid, numeric, text, text, text, text, uuid[])
to authenticated;
