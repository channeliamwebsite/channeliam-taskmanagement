-- 039: daily workflow and notifications.
--
--  A. Notification types LEAVE_SUBMITTED, LEAVE_DECIDED and REPORT_REMINDER,
--     and notifications.dedupe_key: one notification per (user, key), enforced
--     by a unique index, so repeated triggers or job runs never duplicate one.
--     (The 006 index allows one reminder per user and day of ANY type, so it
--     cannot be reused for a second daily reminder.)
--  B. Leave notifications: every active super admin when an employee applies;
--     the employee when the application is approved or rejected.
--  C. Morning plan refresh: a task assigned to someone after they submitted
--     today's morning plan is appended to their planned_task_ids (once, and
--     only until the evening report is submitted). The employee's notes and
--     earlier choices are untouched, and the automatic 09:00 morning_snapshot
--     stays as it was, so "added during the day" and the morning-versus-evening
--     comparison keep working.
--  D. Evening report reminder: from 18:30 workspace time, one reminder per
--     person and day to active Admins and Individuals without an evening report;
--     not on weekly off days, public holidays or approved (non-WFH) leave days.
--     Runs every 30 minutes via pg_cron (job 'evening-report-reminders') and is
--     monitored and re-runnable like the 037/038 jobs.

-- A. -------------------------------------------------------------------------
alter type public.notification_type add value if not exists 'LEAVE_SUBMITTED';
alter type public.notification_type add value if not exists 'LEAVE_DECIDED';
alter type public.notification_type add value if not exists 'REPORT_REMINDER';

alter table public.notifications add column if not exists dedupe_key text
  check (dedupe_key is null or char_length(dedupe_key) <= 200);
create unique index if not exists notifications_one_per_dedupe_key
  on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
comment on column public.notifications.dedupe_key is
  'Set by 039 notifications (leave, evening reminders): at most one notification per user and key.';

-- B. -------------------------------------------------------------------------
create or replace function private.notify_leave_application()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_kind text := case new.leave_type::text when 'CL' then 'casual leave' when 'LWP' then 'leave without pay' when 'WFH' then 'work from home' else lower(new.leave_type::text) end;
  v_dates text := case when new.start_date = new.end_date then to_char(new.start_date, 'DD Mon YYYY')
                       else to_char(new.start_date, 'DD Mon') || ' – ' || to_char(new.end_date, 'DD Mon YYYY') end;
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(trim(p.full_name), ''), p.email) into v_name from public.profiles p where p.id = new.user_id;
    insert into public.notifications (user_id, type, title, message, dedupe_key)
    select sa.id, 'LEAVE_SUBMITTED', 'Leave application to review',
           format('%s applied for %s (%s, %s working day%s).', v_name, v_kind, v_dates, new.working_days,
                  case when new.working_days = 1 then '' else 's' end),
           'leave-submitted:' || new.id
    from public.profiles sa
    where sa.role = 'SUPER_ADMIN' and sa.is_active and sa.id <> new.user_id
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  elsif old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED') then
    insert into public.notifications (user_id, type, title, message, dedupe_key)
    values (new.user_id, 'LEAVE_DECIDED',
            case when new.status = 'APPROVED' then 'Leave approved' else 'Leave rejected' end,
            case when new.status = 'APPROVED' then format('Your %s for %s was approved.', v_kind, v_dates)
                 else format('Your %s for %s was rejected: %s', v_kind, v_dates, coalesce(new.rejection_reason, 'no reason given')) end,
            'leave-decided:' || new.id)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.notify_leave_application() from public, anon, authenticated;

create trigger notify_leave_submitted after insert on public.hr_leave_applications
  for each row execute function private.notify_leave_application();
create trigger notify_leave_decided after update of status on public.hr_leave_applications
  for each row when (old.status is distinct from new.status) execute function private.notify_leave_application();

-- C. -------------------------------------------------------------------------
create or replace function private.add_assigned_task_to_morning_plan()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws uuid;
  v_status public.task_status;
begin
  select t.workspace_id, t.status into v_ws, v_status from public.tasks t where t.id = new.task_id;
  if v_ws is null or v_status in ('COMPLETED', 'CANCELLED') then
    return null;
  end if;
  update public.daily_reports r
     set planned_task_ids = array_append(r.planned_task_ids, new.task_id)
   where r.user_id = new.user_id
     and r.workspace_id = v_ws
     and r.report_date = (now() at time zone private.workspace_timezone(v_ws))::date
     and r.morning_submitted_at is not null
     and r.evening_submitted_at is null
     and not (new.task_id = any (r.planned_task_ids));
  return null;
end;
$$;
revoke all on function private.add_assigned_task_to_morning_plan() from public, anon, authenticated;

create trigger add_assigned_task_to_morning_plan after insert on public.task_assignees
  for each row execute function private.add_assigned_task_to_morning_plan();

-- D. -------------------------------------------------------------------------
create or replace function private.send_evening_report_reminders(p_now timestamptz default now(), p_force boolean default false)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  with ws as (
    select w.id, (p_now at time zone w.timezone)::date as local_date, (p_now at time zone w.timezone)::time as local_time
    from public.workspaces w
  ),
  due as (
    select ws.id as workspace_id, ws.local_date
    from ws
    where (p_force or ws.local_time >= time '18:30')
      and extract(dow from ws.local_date)::smallint <> all (
        coalesce((select s.weekly_off_days from public.hr_settings s limit 1), '{0}'::smallint[]))
      and not exists (select 1 from public.hr_public_holidays h where h.holiday_date = ws.local_date and h.is_active)
  )
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select m.user_id, 'REPORT_REMINDER', 'Evening report due',
         'Please submit today''s evening report before you finish for the day.',
         'evening-report:' || d.workspace_id || ':' || d.local_date
  from due d
  join public.workspace_members m on m.workspace_id = d.workspace_id
  join public.profiles p on p.id = m.user_id
  where p.is_active and p.role <> 'SUPER_ADMIN'
    and not exists (
      select 1 from public.daily_reports r
      where r.user_id = m.user_id and r.workspace_id = d.workspace_id
        and r.report_date = d.local_date and r.evening_submitted_at is not null)
    and not exists (
      select 1 from public.hr_leave_applications l
      where l.user_id = m.user_id and l.status = 'APPROVED' and l.leave_type <> 'WFH'
        and d.local_date between l.start_date and l.end_date)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.send_evening_report_reminders(timestamptz, boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('evening-report-reminders', '0,30 * * * *', 'select private.send_evening_report_reminders()');
  else
    raise notice 'pg_cron is not installed; schedule "select private.send_evening_report_reminders()" every 30 minutes.';
  end if;
end;
$$;

-- Job monitoring and safe retry (037/038) include the new job.
create or replace function public.scheduled_job_health()
returns table (
  job_name text,
  schedule text,
  active boolean,
  last_run_at timestamptz,
  last_status text,
  last_message text,
  runs_24h integer,
  failures_24h integer
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Only a super admin can view scheduled job health' using errcode = '42501';
  end if;
  if to_regclass('cron.job') is null or to_regclass('cron.job_run_details') is null then
    return;
  end if;
  return query execute $q$
    select j.jobname::text, j.schedule::text, j.active,
           last.start_time, last.status::text, left(last.return_message, 300),
           (select count(*)::integer from cron.job_run_details d
             where d.jobid = j.jobid and d.start_time > now() - interval '24 hours'),
           (select count(*)::integer from cron.job_run_details d
             where d.jobid = j.jobid and d.start_time > now() - interval '24 hours' and d.status = 'failed')
    from cron.job j
    left join lateral (
      select d.start_time, d.status, d.return_message
      from cron.job_run_details d
      where d.jobid = j.jobid
      order by d.start_time desc
      limit 1
    ) last on true
    where j.jobname in ('daily-task-reminders', 'daily-morning-reports', 'client-reports', 'evening-report-reminders')
    order by j.jobname
  $q$;
end;
$$;

create or replace function public.retry_scheduled_job(p_job text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_result integer;
begin
  if not private.is_super_admin() then
    raise exception 'Only a super admin can run scheduled jobs' using errcode = '42501';
  end if;
  case p_job
    when 'daily-task-reminders' then
      v_result := private.send_daily_reminders();
    when 'daily-morning-reports' then
      v_result := private.generate_morning_reports();
    when 'client-reports' then
      v_result := private.generate_client_reports();
    when 'evening-report-reminders' then
      v_result := private.send_evening_report_reminders();
    else
      raise exception 'Unknown scheduled job' using errcode = '22023';
  end case;
  return coalesce(v_result, 0);
end;
$$;
