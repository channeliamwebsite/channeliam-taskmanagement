-- 038: automated client reports (every 15 or 30 days per client).
--
--  * client_report_settings: one row per client. Frequency, format (PDF /
--    Excel / both), active flag and an optional recipient. Automatic email
--    delivery is NOT implemented yet: auto_delivery can only be switched on for
--    an explicitly authorised recipient and after an admin has reviewed at
--    least one report; changing the recipient withdraws the authorisation.
--  * client_reports: one row per client and period (unique), holding a frozen
--    JSON snapshot taken at the period cutoff. Snapshots are never rebuilt once
--    READY, so history stays consistent. A failed build is recorded (FAILED,
--    error, attempts) and can be retried safely.
--  * private.generate_client_reports(): builds every period that has ended
--    (India time), at most 36 per client per run. Runs daily via pg_cron
--    (job 'client-reports') and on demand. Idempotent: the unique key and
--    row locks make concurrent or repeated runs harmless.
--  * Contents are team-level only: no employee names, emails, attendance, HR
--    or internal notes (clients.notes is excluded). Task titles of the client's
--    own projects are included as deliverables / outstanding work.
--  * Access: super admins, and admins who are members of the client's
--    workspace. Tables are read-only to the app; all writes go through the
--    functions below.

-- Who may configure, generate, review and download a client's reports.
create or replace function private.can_manage_client_reports(p_client_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    private.current_user_role() = 'SUPER_ADMIN'
    or (private.current_user_role() = 'ADMIN'
        and exists (select 1 from public.clients c
                    where c.id = p_client_id and private.is_workspace_member(c.workspace_id))),
    false)
$$;
revoke all on function private.can_manage_client_reports(uuid) from public, anon;
grant execute on function private.can_manage_client_reports(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.client_report_settings (
  client_id               uuid primary key references public.clients (id) on delete cascade,
  frequency_days          smallint not null check (frequency_days in (15, 30)),
  report_format           text not null default 'BOTH' check (report_format in ('PDF', 'EXCEL', 'BOTH')),
  first_period_start      date not null,
  is_active               boolean not null default true,
  recipient_email         text check (recipient_email is null or (char_length(recipient_email) <= 254 and recipient_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  recipient_authorized_at timestamptz,
  recipient_authorized_by uuid references public.profiles (id) on delete set null,
  auto_delivery           boolean not null default false,
  updated_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint client_report_settings_authorized_recipient check (
    recipient_authorized_at is null or recipient_email is not null),
  constraint client_report_settings_delivery_needs_authorization check (
    not auto_delivery or recipient_authorized_at is not null)
);

create table public.client_reports (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients (id) on delete restrict,
  period_start    date not null,
  period_end      date not null,
  frequency_days  smallint not null check (frequency_days in (15, 30)),
  status          text not null default 'PENDING' check (status in ('PENDING', 'READY', 'FAILED')),
  snapshot        jsonb,
  error           text check (error is null or char_length(error) <= 500),
  attempts        integer not null default 0 check (attempts >= 0),
  generated_at    timestamptz,
  generated_by    uuid references public.profiles (id) on delete set null,  -- null = scheduler
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  updates_note    text check (updates_note is null or char_length(updates_note) <= 4000),
  priorities_note text check (priorities_note is null or char_length(priorities_note) <= 4000),
  created_at      timestamptz not null default now(),
  constraint client_reports_period_key unique (client_id, period_start),
  constraint client_reports_period_check check (period_end >= period_start),
  constraint client_reports_ready_has_snapshot check (status <> 'READY' or snapshot is not null),
  constraint client_reports_review_needs_ready check (reviewed_at is null or status = 'READY')
);
create index client_reports_client_period_idx on public.client_reports (client_id, period_end desc);
create index client_reports_failed_idx on public.client_reports (client_id) where status = 'FAILED';

comment on table public.client_reports is
  'Client report per period with a frozen snapshot (team-level only). Written only by 038 functions.';

alter table public.client_report_settings enable row level security;
alter table public.client_reports enable row level security;

create policy "client_report_settings: report managers read"
  on public.client_report_settings for select to authenticated
  using ((select private.can_manage_client_reports(client_id)));
create policy "client_reports: report managers read"
  on public.client_reports for select to authenticated
  using ((select private.can_manage_client_reports(client_id)));

revoke all on public.client_report_settings, public.client_reports from anon, authenticated;
grant select on public.client_report_settings, public.client_reports to authenticated;

-- A ready snapshot is history: it never changes.
create or replace function private.protect_client_report_snapshot()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.status = 'READY' and (new.snapshot is distinct from old.snapshot or new.status <> 'READY'
      or new.period_start <> old.period_start or new.period_end <> old.period_end or new.client_id <> old.client_id) then
    raise exception 'A generated client report cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create or replace function private.prevent_client_report_delete()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Client reports are history and cannot be deleted' using errcode = '42501';
end;
$$;
revoke all on function private.protect_client_report_snapshot(), private.prevent_client_report_delete() from public, anon, authenticated;

create trigger protect_client_report_snapshot before update on public.client_reports
  for each row execute function private.protect_client_report_snapshot();
create trigger protect_client_report_delete before delete on public.client_reports
  for each row execute function private.prevent_client_report_delete();

-- -----------------------------------------------------------------------------
-- Snapshot (team-level; India time; cutoff = end of period_end)
-- -----------------------------------------------------------------------------
create or replace function private.client_report_snapshot(p_client_id uuid, p_start date, p_end date, p_frequency smallint)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with bounds as (
    select (p_start::timestamp at time zone 'Asia/Kolkata') as start_ts,
           ((p_end + 1)::timestamp at time zone 'Asia/Kolkata') as end_ts
  ),
  scope as (
    -- Leaf, non-cancelled tasks of the client's projects that existed by the
    -- cutoff and were not already finished before the period.
    select t.id, t.title, t.status, t.priority, t.due_date, p.id as project_id, p.name as project_name,
           coalesce(t.completed_at, case when t.status = 'COMPLETED' then t.updated_at end) as done_at
    from public.tasks t
    join public.projects p on p.id = t.project_id
    cross join bounds b
    where p.client_id = p_client_id
      and t.status <> 'CANCELLED'
      and t.created_at < b.end_ts
      and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.status <> 'CANCELLED')
      and coalesce(t.completed_at, case when t.status = 'COMPLETED' then t.updated_at end, b.end_ts) >= b.start_ts
  ),
  classified as (
    select s.*,
           (s.done_at is not null and s.done_at < b.end_ts) as done,
           case
             when s.done_at is not null and s.done_at < b.end_ts then 'COMPLETED'
             when s.done_at is not null or s.status in ('IN_PROGRESS', 'IN_REVIEW') then 'IN_PROGRESS'
             else 'PENDING'
           end as state,
           (not (s.done_at is not null and s.done_at < b.end_ts) and s.due_date is not null and s.due_date <= p_end) as overdue
    from scope s cross join bounds b
  ),
  totals as (
    select count(*)::int as total,
           count(*) filter (where state = 'COMPLETED')::int as completed,
           count(*) filter (where state = 'PENDING')::int as pending,
           count(*) filter (where state = 'IN_PROGRESS')::int as in_progress,
           count(*) filter (where overdue)::int as overdue,
           count(*) filter (where status = 'BLOCKED' and state <> 'COMPLETED')::int as blocked
    from classified
  ),
  by_project as (
    select project_name, count(*)::int as total,
           count(*) filter (where state = 'COMPLETED')::int as completed,
           count(*) filter (where state = 'IN_PROGRESS')::int as in_progress,
           count(*) filter (where state = 'PENDING')::int as pending,
           count(*) filter (where overdue)::int as overdue
    from classified group by project_id, project_name
  ),
  by_team as (
    -- Department of each assignee (profiles.team); no names. A task shared by
    -- two teams counts for both.
    select coalesce(nullif(trim(pr.team), ''), 'General') as team,
           count(distinct c.id) filter (where c.state = 'COMPLETED')::int as completed,
           count(distinct c.id) filter (where c.state <> 'COMPLETED')::int as open
    from classified c
    join public.task_assignees ta on ta.task_id = c.id
    join public.profiles pr on pr.id = ta.user_id
    group by 1
  ),
  deliverables as (
    select title, project_name, (done_at at time zone 'Asia/Kolkata')::date as completed_on
    from classified where state = 'COMPLETED' order by done_at, title limit 300
  ),
  outstanding as (
    select title, project_name, priority, state, due_date, overdue
    from classified where state <> 'COMPLETED'
    order by overdue desc, due_date nulls last, title limit 300
  ),
  next_priorities as (
    select title, project_name, priority, due_date
    from classified
    where state <> 'COMPLETED'
      and (priority in ('URGENT', 'HIGH') or (due_date is not null and due_date <= p_end + p_frequency))
    order by priority desc, due_date nulls last, title limit 20
  )
  select jsonb_build_object(
    'version', 1,
    'timezone', 'Asia/Kolkata',
    'client', (select jsonb_build_object('name', c.name, 'contact_name', c.contact_name) from public.clients c where c.id = p_client_id),
    'period', jsonb_build_object('start', p_start, 'end', p_end, 'frequency_days', p_frequency),
    'totals', (select to_jsonb(t) || jsonb_build_object('completion_percent',
                 case when t.total > 0 then round(100.0 * t.completed / t.total)::int else 0 end) from totals t),
    'projects', coalesce((select jsonb_agg(to_jsonb(b) || jsonb_build_object('completion_percent',
                 case when b.total > 0 then round(100.0 * b.completed / b.total)::int else 0 end) order by b.project_name) from by_project b), '[]'),
    'teams', coalesce((select jsonb_agg(to_jsonb(b) order by b.team) from by_team b), '[]'),
    'deliverables', coalesce((select jsonb_agg(to_jsonb(d)) from deliverables d), '[]'),
    'outstanding', coalesce((select jsonb_agg(to_jsonb(o)) from outstanding o), '[]'),
    'next_priorities', coalesce((select jsonb_agg(to_jsonb(n)) from next_priorities n), '[]')
  )
$$;
revoke all on function private.client_report_snapshot(uuid, date, date, smallint) from public, anon, authenticated;

-- Builds one PENDING or FAILED report (locks the row; a READY one is left alone).
create or replace function private.build_client_report(p_report_id uuid, p_actor uuid default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  r public.client_reports;
  v_snapshot jsonb;
begin
  select * into r from public.client_reports where id = p_report_id for update skip locked;
  if not found or r.status = 'READY' then
    return coalesce(r.status, 'BUSY');
  end if;
  begin
    v_snapshot := private.client_report_snapshot(r.client_id, r.period_start, r.period_end, r.frequency_days);
    update public.client_reports
      set snapshot = v_snapshot, status = 'READY', error = null, attempts = attempts + 1,
          generated_at = now(), generated_by = p_actor
      where id = r.id;
    return 'READY';
  exception when others then
    update public.client_reports
      set status = 'FAILED', error = left(sqlerrm, 500), attempts = attempts + 1, generated_by = p_actor
      where id = r.id;
    return 'FAILED';
  end;
end;
$$;
revoke all on function private.build_client_report(uuid, uuid) from public, anon, authenticated;

-- Creates and builds every ended period for active settings; retries FAILED
-- reports (up to 5 attempts each). Returns the number of reports made READY.
create or replace function private.generate_client_reports(
  p_today date default (now() at time zone 'Asia/Kolkata')::date,
  p_client_id uuid default null,
  p_actor uuid default null
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  v_start date;
  v_id uuid;
  v_made integer := 0;
  v_n integer;
begin
  for s in
    select rs.* from public.client_report_settings rs
    join public.clients c on c.id = rs.client_id
    where rs.is_active and c.is_active and (p_client_id is null or rs.client_id = p_client_id)
  loop
    -- Retry failed periods first.
    for v_id in select id from public.client_reports
                where client_id = s.client_id and status = 'FAILED' and attempts < 5 order by period_start loop
      if private.build_client_report(v_id, p_actor) = 'READY' then v_made := v_made + 1; end if;
    end loop;
    -- Then every period that has fully ended, continuing after the last one.
    select coalesce(max(period_end) + 1, s.first_period_start) into v_start
      from public.client_reports where client_id = s.client_id;
    v_n := 0;
    while v_start + s.frequency_days - 1 < p_today and v_n < 36 loop
      insert into public.client_reports (client_id, period_start, period_end, frequency_days)
      values (s.client_id, v_start, v_start + s.frequency_days - 1, s.frequency_days)
      on conflict (client_id, period_start) do nothing
      returning id into v_id;
      if v_id is not null and private.build_client_report(v_id, p_actor) = 'READY' then v_made := v_made + 1; end if;
      v_start := v_start + s.frequency_days;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_made;
end;
$$;
revoke all on function private.generate_client_reports(date, uuid, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- App functions (report managers)
-- -----------------------------------------------------------------------------
create or replace function public.save_client_report_settings(
  p_client_id uuid,
  p_frequency_days smallint,
  p_report_format text,
  p_first_period_start date,
  p_is_active boolean,
  p_recipient_email text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := nullif(lower(trim(p_recipient_email)), '');
begin
  if not private.can_manage_client_reports(p_client_id) then
    raise exception 'You cannot manage reports for this client' using errcode = '42501';
  end if;
  insert into public.client_report_settings (client_id, frequency_days, report_format, first_period_start, is_active, recipient_email, updated_by)
  values (p_client_id, p_frequency_days, p_report_format, p_first_period_start, p_is_active, v_email, auth.uid())
  on conflict (client_id) do update set
    frequency_days = excluded.frequency_days,
    report_format = excluded.report_format,
    first_period_start = excluded.first_period_start,
    is_active = excluded.is_active,
    recipient_email = excluded.recipient_email,
    -- A new recipient must be authorised again; delivery stops until then.
    recipient_authorized_at = case when public.client_report_settings.recipient_email is distinct from excluded.recipient_email
                                   then null else public.client_report_settings.recipient_authorized_at end,
    recipient_authorized_by = case when public.client_report_settings.recipient_email is distinct from excluded.recipient_email
                                   then null else public.client_report_settings.recipient_authorized_by end,
    auto_delivery = case when public.client_report_settings.recipient_email is distinct from excluded.recipient_email
                         then false else public.client_report_settings.auto_delivery end,
    updated_by = auth.uid(),
    updated_at = now();
end;
$$;

-- Explicit authorisation of the current recipient, and the delivery switch.
-- Delivery needs an authorised recipient and at least one reviewed report.
create or replace function public.set_client_report_delivery(p_client_id uuid, p_authorize_recipient boolean, p_auto_delivery boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.client_report_settings;
begin
  if not private.can_manage_client_reports(p_client_id) then
    raise exception 'You cannot manage reports for this client' using errcode = '42501';
  end if;
  select * into v from public.client_report_settings where client_id = p_client_id for update;
  if not found then raise exception 'Save the report settings first' using errcode = 'P0002'; end if;
  if p_authorize_recipient and v.recipient_email is null then
    raise exception 'Add a recipient email first' using errcode = '22023';
  end if;
  if p_auto_delivery and not exists (select 1 from public.client_reports where client_id = p_client_id and reviewed_at is not null) then
    raise exception 'Review at least one report before enabling automatic delivery' using errcode = '22023';
  end if;
  update public.client_report_settings set
    recipient_authorized_at = case when p_authorize_recipient then coalesce(recipient_authorized_at, now()) end,
    recipient_authorized_by = case when p_authorize_recipient then coalesce(recipient_authorized_by, auth.uid()) end,
    auto_delivery = p_auto_delivery and p_authorize_recipient,
    updated_by = auth.uid(),
    updated_at = now()
  where client_id = p_client_id;
end;
$$;

-- Generate due reports for one client now (same idempotent path as the scheduler).
create or replace function public.generate_client_reports_now(p_client_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.can_manage_client_reports(p_client_id) then
    raise exception 'You cannot manage reports for this client' using errcode = '42501';
  end if;
  return private.generate_client_reports((now() at time zone 'Asia/Kolkata')::date, p_client_id, auth.uid());
end;
$$;

-- Retry one failed report.
create or replace function public.retry_client_report(p_report_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_client uuid;
begin
  select client_id into v_client from public.client_reports where id = p_report_id;
  if v_client is null or not private.can_manage_client_reports(v_client) then
    raise exception 'You cannot manage this report' using errcode = '42501';
  end if;
  return private.build_client_report(p_report_id, auth.uid());
end;
$$;

-- Admin review: notes for "Important updates" / "Next-period priorities", and
-- marking the report reviewed. Notes are locked once reviewed.
create or replace function public.review_client_report(p_report_id uuid, p_updates_note text, p_priorities_note text, p_mark_reviewed boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.client_reports;
begin
  select * into r from public.client_reports where id = p_report_id for update;
  if not found or not private.can_manage_client_reports(r.client_id) then
    raise exception 'You cannot manage this report' using errcode = '42501';
  end if;
  if r.status <> 'READY' then raise exception 'Only a generated report can be reviewed' using errcode = '22023'; end if;
  if r.reviewed_at is not null then raise exception 'This report has already been reviewed' using errcode = '22023'; end if;
  update public.client_reports set
    updates_note = nullif(trim(p_updates_note), ''),
    priorities_note = nullif(trim(p_priorities_note), ''),
    reviewed_at = case when p_mark_reviewed then now() end,
    reviewed_by = case when p_mark_reviewed then auth.uid() end
  where id = p_report_id;
end;
$$;

revoke all on function public.save_client_report_settings(uuid, smallint, text, date, boolean, text),
  public.set_client_report_delivery(uuid, boolean, boolean), public.generate_client_reports_now(uuid),
  public.retry_client_report(uuid), public.review_client_report(uuid, text, text, boolean) from public, anon;
grant execute on function public.save_client_report_settings(uuid, smallint, text, date, boolean, text),
  public.set_client_report_delivery(uuid, boolean, boolean), public.generate_client_reports_now(uuid),
  public.retry_client_report(uuid), public.review_client_report(uuid, text, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Schedule (daily 06:15 India time) and job monitoring (037) for 'client-reports'
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('client-reports', '45 0 * * *', 'select private.generate_client_reports()');
  else
    raise notice 'pg_cron is not installed; schedule "select private.generate_client_reports()" daily.';
  end if;
end;
$$;

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
    where j.jobname in ('daily-task-reminders', 'daily-morning-reports', 'client-reports')
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
    else
      raise exception 'Unknown scheduled job' using errcode = '22023';
  end case;
  return coalesce(v_result, 0);
end;
$$;
