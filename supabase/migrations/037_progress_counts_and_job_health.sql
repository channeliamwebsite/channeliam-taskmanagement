-- 037: production stabilisation (read-only helpers and one equivalent policy rewrite; no table or data changes).
--
--  A. public.project_task_counts(project_ids): leaf-task totals per project,
--     computed in the database instead of shipping every task to the app.
--     Same rule as src/lib/progress.ts countLeafTasks: among the caller's
--     visible, non-cancelled tasks, a task counts unless another such task
--     names it as its parent; "completed" = status COMPLETED. SECURITY INVOKER,
--     so RLS decides visibility exactly as the old per-row reads did.
--
--  B. public.scheduled_job_health(): last run, status and 24-hour failure count
--     of the app's pg_cron jobs, for super admins. Empty when pg_cron is not
--     installed (the cron schema is only read dynamically).
--
--  C. public.retry_scheduled_job(name): lets a super admin re-run one of those
--     jobs now. Both job functions are idempotent (reminders are de-duplicated
--     per user and day, morning reports are written once per user and day), and
--     they are run in their normal mode (p_force = false), so a retry can never
--     create duplicates.

-- A. -------------------------------------------------------------------------
create or replace function public.project_task_counts(p_project_ids uuid[])
returns table (project_id uuid, total integer, completed integer)
language sql stable security invoker set search_path = ''
as $$
  -- Visible tasks are read once (RLS is evaluated once per row); a task is a
  -- parent when another of these rows names it, as in countLeafTasks.
  with visible as materialized (
    select t.id, t.project_id, t.status, t.parent_task_id
    from public.tasks t
    where t.project_id = any (p_project_ids) and t.status <> 'CANCELLED'
  ),
  parents as (
    select distinct parent_task_id as id from visible where parent_task_id is not null
  )
  select v.project_id,
         count(*)::integer as total,
         count(*) filter (where v.status = 'COMPLETED')::integer as completed
  from visible v
  where not exists (select 1 from parents p where p.id = v.id)
  group by v.project_id
$$;

comment on function public.project_task_counts(uuid[]) is
  'Leaf-task totals per project for the caller (RLS applies). Mirrors src/lib/progress.ts countLeafTasks.';

revoke all on function public.project_task_counts(uuid[]) from public, anon;
grant execute on function public.project_task_counts(uuid[]) to authenticated;

-- B. -------------------------------------------------------------------------
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
    where j.jobname in ('daily-task-reminders', 'daily-morning-reports')
    order by j.jobname
  $q$;
end;
$$;

revoke all on function public.scheduled_job_health() from public, anon;
grant execute on function public.scheduled_job_health() to authenticated;

-- C. -------------------------------------------------------------------------
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
    else
      raise exception 'Unknown scheduled job' using errcode = '22023';
  end case;
  return coalesce(v_result, 0);
end;
$$;

comment on function public.retry_scheduled_job(text) is
  'Super admins: run one of the app''s idempotent scheduled jobs now (normal mode, never forced).';

revoke all on function public.retry_scheduled_job(text) from public, anon;
grant execute on function public.retry_scheduled_job(text) to authenticated;

-- D. -------------------------------------------------------------------------
-- Performance only (measured with one year of data: 14.5k tasks): for super
-- admins, "tasks: read accessible" built the full accessible_task_ids() set
-- (every task, plus recursion) on every query, although the separate policy
-- "tasks: company admins read all" already lets them read every task. Checking
-- is_company_admin() first lets PostgreSQL skip that set for them. Who can read
-- what is unchanged: the result is the same union of the two policies.
alter policy "tasks: read accessible" on public.tasks using (
  (select private.is_company_admin())
  or id in (select private.accessible_task_ids())
  or (created_by = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()))
);
