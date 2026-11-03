-- =============================================================================
-- 034_hr_leave_and_holidays.sql   (new tables, types and functions; extends
-- the attendance audit actions and the employee-history check; no data changes)
--
-- Attendance & HR module, phases 3-4 (decided 2026-11-03):
--   * Public holidays are company-wide (all active employees), managed by
--     super admins only. A date has at most one active holiday. Holidays are
--     cancelled (is_active = false), never deleted, so history is kept.
--   * Leave types: Casual Leave (CL, paid, 12 days a calendar year to start,
--     configurable), Leave Without Pay (LWP, unpaid, recorded separately, no
--     balance) and Work From Home (WFH, not leave, no balance). A super admin
--     can override one employee's allowance for one year.
--   * An application covers dates within one calendar year and counts working
--     days only: weekly offs (hr_settings, Sunday) and active public holidays
--     are not counted.
--   * Employees apply for themselves; applications start PENDING. Only a super
--     admin approves or rejects (a reason is required to reject), never their
--     own application. The applicant can cancel while it is pending. Pending,
--     rejected and cancelled applications do not affect attendance; the app
--     shows approved ones on the attendance calendar.
--   * No two pending/approved applications of the same employee overlap
--     (exclusion constraint), so approved leave never overlaps.
--   * The CL balance is always derived: allowance - approved working days -
--     pending working days, recalculated with today's holidays.
--   * Every application, decision, cancellation, holiday and policy change is
--     written to attendance_audit_log (readable by the employee concerned and
--     super admins only).
-- Access: HR tables are hr_*; reads are own rows or super admins
-- (private.is_super_admin(), 024); deactivated accounts get nothing (032).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit actions
-- -----------------------------------------------------------------------------
alter table public.attendance_audit_log drop constraint if exists attendance_audit_log_action_check;
alter table public.attendance_audit_log add constraint attendance_audit_log_action_check
  check (action in ('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END', 'SETTINGS_UPDATED',
                    'LEAVE_APPLIED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED',
                    'LEAVE_POLICY_UPDATED', 'LEAVE_ALLOWANCE_SET',
                    'HOLIDAY_CREATED', 'HOLIDAY_UPDATED', 'HOLIDAY_CANCELLED'));

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'hr_leave_type' and typnamespace = 'public'::regnamespace) then
    create type public.hr_leave_type as enum ('CL', 'LWP', 'WFH');
  end if;
  if not exists (select 1 from pg_type where typname = 'hr_leave_status' and typnamespace = 'public'::regnamespace) then
    create type public.hr_leave_status as enum ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Public holidays
-- -----------------------------------------------------------------------------
create table if not exists public.hr_public_holidays (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  holiday_date  date not null,
  description   text check (description is null or char_length(description) <= 500),
  is_active     boolean not null default true,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now()
);

comment on table public.hr_public_holidays is
  'Company-wide public holidays. Cancel with is_active = false (never deleted). One active holiday per date.';

create unique index if not exists hr_public_holidays_one_per_date_idx on public.hr_public_holidays (holiday_date) where is_active;
create index if not exists hr_public_holidays_date_idx on public.hr_public_holidays (holiday_date);

create or replace function private.audit_hr_holiday()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_by := new.created_by;
    new.updated_at := now();
    perform private.log_attendance(null, 'HOLIDAY_CREATED', 'hr_public_holiday', new.id, null,
      jsonb_build_object('name', new.name, 'date', new.holiday_date));
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := (select auth.uid());
    new.updated_at := now();
    perform private.log_attendance(null,
      case when old.is_active and not new.is_active then 'HOLIDAY_CANCELLED' else 'HOLIDAY_UPDATED' end,
      'hr_public_holiday', new.id, null,
      jsonb_build_object('before', jsonb_build_object('name', old.name, 'date', old.holiday_date, 'active', old.is_active),
                         'after',  jsonb_build_object('name', new.name, 'date', new.holiday_date, 'active', new.is_active)));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_hr_holiday on public.hr_public_holidays;
create trigger audit_hr_holiday before insert or update on public.hr_public_holidays
  for each row execute function private.audit_hr_holiday();

alter table public.hr_public_holidays enable row level security;
drop policy if exists "hr_public_holidays: active employees read" on public.hr_public_holidays;
create policy "hr_public_holidays: active employees read"
  on public.hr_public_holidays for select to authenticated
  using ((select private.current_user_role()) is not null);
drop policy if exists "hr_public_holidays: super admins add" on public.hr_public_holidays;
create policy "hr_public_holidays: super admins add"
  on public.hr_public_holidays for insert to authenticated
  with check (private.is_super_admin());
drop policy if exists "hr_public_holidays: super admins edit" on public.hr_public_holidays;
create policy "hr_public_holidays: super admins edit"
  on public.hr_public_holidays for update to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

revoke all on public.hr_public_holidays from public, anon, authenticated;
grant select on public.hr_public_holidays to authenticated;
grant insert (name, holiday_date, description) on public.hr_public_holidays to authenticated;
grant update (name, holiday_date, description, is_active) on public.hr_public_holidays to authenticated;

-- -----------------------------------------------------------------------------
-- Leave policy (one row per type) and per-employee allowance overrides
-- -----------------------------------------------------------------------------
create table if not exists public.hr_leave_policies (
  leave_type        public.hr_leave_type primary key,
  label             text not null,
  annual_allowance  numeric(5,1) check (annual_allowance is null or annual_allowance between 0 and 366),
  is_paid           boolean not null,
  uses_balance      boolean not null,
  updated_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now(),
  constraint hr_leave_policies_balance_needs_allowance check (not uses_balance or annual_allowance is not null)
);

insert into public.hr_leave_policies (leave_type, label, annual_allowance, is_paid, uses_balance) values
  ('CL', 'Casual Leave', 12, true, true),
  ('LWP', 'Leave Without Pay', null, false, false),
  ('WFH', 'Work From Home', null, true, false)
on conflict (leave_type) do nothing;

create or replace function private.audit_hr_leave_policy()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  perform private.log_attendance(null, 'LEAVE_POLICY_UPDATED', 'hr_leave_policy', null, null,
    jsonb_build_object('leave_type', new.leave_type, 'before', old.annual_allowance, 'after', new.annual_allowance));
  return new;
end;
$$;

drop trigger if exists audit_hr_leave_policy on public.hr_leave_policies;
create trigger audit_hr_leave_policy before update on public.hr_leave_policies
  for each row execute function private.audit_hr_leave_policy();

alter table public.hr_leave_policies enable row level security;
drop policy if exists "hr_leave_policies: active employees read" on public.hr_leave_policies;
create policy "hr_leave_policies: active employees read"
  on public.hr_leave_policies for select to authenticated
  using ((select private.current_user_role()) is not null);
drop policy if exists "hr_leave_policies: super admins edit" on public.hr_leave_policies;
create policy "hr_leave_policies: super admins edit"
  on public.hr_leave_policies for update to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

revoke all on public.hr_leave_policies from public, anon, authenticated;
grant select on public.hr_leave_policies to authenticated;
grant update (annual_allowance) on public.hr_leave_policies to authenticated;

create table if not exists public.hr_leave_allowances (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  year        integer not null check (year between 2000 and 2100),
  leave_type  public.hr_leave_type not null,
  days        numeric(5,1) not null check (days between 0 and 366),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, year, leave_type)
);

comment on table public.hr_leave_allowances is
  'Optional per-employee, per-year allowance overriding hr_leave_policies.annual_allowance.';

create or replace function private.audit_hr_leave_allowance()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  perform private.log_attendance(null, 'LEAVE_ALLOWANCE_SET', 'hr_leave_allowance', null, new.user_id,
    jsonb_build_object('year', new.year, 'leave_type', new.leave_type,
                       'before', case when tg_op = 'UPDATE' then old.days end, 'after', new.days));
  return new;
end;
$$;

drop trigger if exists audit_hr_leave_allowance on public.hr_leave_allowances;
create trigger audit_hr_leave_allowance before insert or update on public.hr_leave_allowances
  for each row execute function private.audit_hr_leave_allowance();

alter table public.hr_leave_allowances enable row level security;
drop policy if exists "hr_leave_allowances: own and super admins read" on public.hr_leave_allowances;
create policy "hr_leave_allowances: own and super admins read"
  on public.hr_leave_allowances for select to authenticated
  using (user_id = (select auth.uid()) or private.is_super_admin());
drop policy if exists "hr_leave_allowances: super admins add" on public.hr_leave_allowances;
create policy "hr_leave_allowances: super admins add"
  on public.hr_leave_allowances for insert to authenticated
  with check (private.is_super_admin());
drop policy if exists "hr_leave_allowances: super admins edit" on public.hr_leave_allowances;
create policy "hr_leave_allowances: super admins edit"
  on public.hr_leave_allowances for update to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

revoke all on public.hr_leave_allowances from public, anon, authenticated;
grant select on public.hr_leave_allowances to authenticated;
grant insert (user_id, year, leave_type, days) on public.hr_leave_allowances to authenticated;
grant update (days) on public.hr_leave_allowances to authenticated;

-- -----------------------------------------------------------------------------
-- Leave applications
-- -----------------------------------------------------------------------------
create table if not exists public.hr_leave_applications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  leave_type        public.hr_leave_type not null,
  start_date        date not null,
  end_date          date not null,
  working_days      integer not null check (working_days > 0),
  reason            text not null check (char_length(btrim(reason)) between 3 and 1000),
  status            public.hr_leave_status not null default 'PENDING',
  decided_by        uuid references public.profiles (id) on delete set null,
  decided_at        timestamptz,
  rejection_reason  text check (rejection_reason is null or char_length(rejection_reason) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint hr_leave_applications_range_check check (end_date >= start_date),
  constraint hr_leave_applications_one_year check (extract(year from start_date) = extract(year from end_date)),
  constraint hr_leave_applications_decision_check check (
    (status = 'PENDING' and decided_by is null and decided_at is null)
    or (status in ('APPROVED', 'REJECTED') and decided_at is not null)
    or status = 'CANCELLED'),
  constraint hr_leave_applications_rejection_reason check (status <> 'REJECTED' or char_length(btrim(coalesce(rejection_reason, ''))) >= 3),
  constraint hr_leave_applications_no_overlap exclude using gist (
    user_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('PENDING', 'APPROVED'))
);

comment on table public.hr_leave_applications is
  'Leave and WFH applications. Written only by hr_apply_leave / hr_cancel_leave / hr_decide_leave. working_days is the count at application (or approval) time.';

create index if not exists hr_leave_applications_user_idx on public.hr_leave_applications (user_id, start_date);
create index if not exists hr_leave_applications_status_idx on public.hr_leave_applications (status, start_date);

alter table public.hr_leave_applications enable row level security;
drop policy if exists "hr_leave_applications: own and super admins read" on public.hr_leave_applications;
create policy "hr_leave_applications: own and super admins read"
  on public.hr_leave_applications for select to authenticated
  using (user_id = (select auth.uid()) or private.is_super_admin());

revoke all on public.hr_leave_applications from public, anon, authenticated;
grant select on public.hr_leave_applications to authenticated;

-- Deactivated accounts get nothing from any HR table (as 032).
do $$
declare t text;
begin
  foreach t in array array['hr_public_holidays', 'hr_leave_policies', 'hr_leave_allowances', 'hr_leave_applications'] loop
    execute format('drop policy if exists %I on public.%I', t || ': active accounts only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated
                      using ((select private.current_user_role()) is not null)
                      with check ((select private.current_user_role()) is not null)', t || ': active accounts only', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Calculations
-- -----------------------------------------------------------------------------

-- Working days in [start, end]: not a weekly off (hr_settings) and not an active holiday.
create or replace function private.hr_working_days(p_start date, p_end date)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
  from generate_series(p_start, p_end, interval '1 day') as g(d)
  where p_start <= p_end
    and extract(dow from g.d)::smallint <> all (coalesce((select weekly_off_days from public.hr_settings where id), '{0}'::smallint[]))
    and not exists (select 1 from public.hr_public_holidays h where h.holiday_date = g.d::date and h.is_active)
$$;

-- Allowance of one leave type for one employee and year (null = no balance).
create or replace function private.hr_leave_allowance(p_user uuid, p_type public.hr_leave_type, p_year integer)
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case when p.uses_balance
              then coalesce((select a.days from public.hr_leave_allowances a
                             where a.user_id = p_user and a.year = p_year and a.leave_type = p_type), p.annual_allowance)
         end
  from public.hr_leave_policies p
  where p.leave_type = p_type
$$;

-- Working days taken in one year by status, recalculated with today's holidays.
create or replace function private.hr_leave_days(p_user uuid, p_type public.hr_leave_type, p_year integer, p_status public.hr_leave_status)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(private.hr_working_days(greatest(a.start_date, make_date(p_year, 1, 1)), least(a.end_date, make_date(p_year, 12, 31)))), 0)::int
  from public.hr_leave_applications a
  where a.user_id = p_user and a.leave_type = p_type and a.status = p_status
    and a.start_date <= make_date(p_year, 12, 31) and a.end_date >= make_date(p_year, 1, 1)
$$;

-- Public: working days between two dates (for the application form).
create or replace function public.hr_working_days(p_start date, p_end date)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.current_user_role() is null then
    raise exception 'Sign in with an active account' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    return 0;
  end if;
  return private.hr_working_days(p_start, p_end);
end;
$$;

-- Public: an employee's leave summary for a year (own, or anyone's for a super admin).
create or replace function public.hr_leave_balance(p_user_id uuid default null, p_year integer default null)
returns table (leave_type public.hr_leave_type, allowance numeric, approved integer, pending integer, available numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user uuid := coalesce(p_user_id, (select auth.uid()));
  v_year integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Kolkata'))::int);
begin
  if private.current_user_role() is null then
    raise exception 'Sign in with an active account' using errcode = '42501';
  end if;
  if v_user <> (select auth.uid()) and not private.is_super_admin() then
    raise exception 'You can only see your own leave balance' using errcode = '42501';
  end if;
  return query
    select p.leave_type,
           private.hr_leave_allowance(v_user, p.leave_type, v_year),
           private.hr_leave_days(v_user, p.leave_type, v_year, 'APPROVED'),
           private.hr_leave_days(v_user, p.leave_type, v_year, 'PENDING'),
           case when p.uses_balance
                then private.hr_leave_allowance(v_user, p.leave_type, v_year)
                     - private.hr_leave_days(v_user, p.leave_type, v_year, 'APPROVED')
                     - private.hr_leave_days(v_user, p.leave_type, v_year, 'PENDING')
           end
    from public.hr_leave_policies p
    order by p.leave_type;
end;
$$;

-- -----------------------------------------------------------------------------
-- Apply, cancel, decide
-- -----------------------------------------------------------------------------
create or replace function public.hr_apply_leave(p_type public.hr_leave_type, p_start date, p_end date, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_days integer;
  v_available numeric;
  v_id uuid;
begin
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Sign in with an active account to apply for leave' using errcode = '42501';
  end if;
  if p_type is null or p_start is null or p_end is null then
    raise exception 'Choose a leave type, a start date and an end date.' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'The end date is before the start date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave application must stay within one calendar year. Apply separately for each year.' using errcode = '22023';
  end if;
  if char_length(v_reason) not between 3 and 1000 then
    raise exception 'Give a reason (3 to 1000 characters).' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.hr_leave_applications:' || v_uid::text));

  v_days := private.hr_working_days(p_start, p_end);
  if v_days = 0 then
    raise exception 'There are no working days in these dates (Sundays and public holidays are not counted).' using errcode = '22023';
  end if;
  if exists (select 1 from public.hr_leave_applications a
             where a.user_id = v_uid and a.status in ('PENDING', 'APPROVED')
               and daterange(a.start_date, a.end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'You already have a pending or approved application for some of these dates.' using errcode = '23P01';
  end if;
  if (select uses_balance from public.hr_leave_policies where leave_type = p_type) then
    v_available := private.hr_leave_allowance(v_uid, p_type, extract(year from p_start)::int)
                   - private.hr_leave_days(v_uid, p_type, extract(year from p_start)::int, 'APPROVED')
                   - private.hr_leave_days(v_uid, p_type, extract(year from p_start)::int, 'PENDING');
    if v_days > v_available then
      raise exception 'Not enough Casual Leave: % day(s) available, % requested.', greatest(v_available, 0), v_days using errcode = '23514';
    end if;
  end if;

  insert into public.hr_leave_applications (user_id, leave_type, start_date, end_date, working_days, reason)
  values (v_uid, p_type, p_start, p_end, v_days, v_reason)
  returning id into v_id;

  perform private.log_attendance(null, 'LEAVE_APPLIED', 'hr_leave_application', v_id, v_uid,
    jsonb_build_object('leave_type', p_type, 'start', p_start, 'end', p_end, 'working_days', v_days));
  return v_id;
end;
$$;

create or replace function public.hr_cancel_leave(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_app public.hr_leave_applications;
begin
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Sign in with an active account' using errcode = '42501';
  end if;
  select * into v_app from public.hr_leave_applications where id = p_id and user_id = v_uid for update;
  if not found then
    raise exception 'Leave application not found.' using errcode = 'P0002';
  end if;
  if v_app.status <> 'PENDING' then
    raise exception 'Only a pending application can be cancelled.' using errcode = '55000';
  end if;
  update public.hr_leave_applications set status = 'CANCELLED', updated_at = now() where id = p_id;
  perform private.log_attendance(null, 'LEAVE_CANCELLED', 'hr_leave_application', p_id, v_uid, '{}'::jsonb);
end;
$$;

create or replace function public.hr_decide_leave(p_id uuid, p_approve boolean, p_rejection_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_app public.hr_leave_applications;
  v_days integer;
  v_available numeric;
  v_year integer;
begin
  if v_uid is null or not private.is_super_admin() then
    raise exception 'Only a super admin can approve or reject leave.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;

  select * into v_app from public.hr_leave_applications where id = p_id;
  if not found then
    raise exception 'Leave application not found.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.hr_leave_applications:' || v_app.user_id::text));
  select * into v_app from public.hr_leave_applications where id = p_id for update;

  if v_app.user_id = v_uid then
    raise exception 'You cannot approve or reject your own leave application.' using errcode = '42501';
  end if;
  if v_app.status <> 'PENDING' then
    raise exception 'This application has already been decided or cancelled.' using errcode = '55000';
  end if;

  if not p_approve then
    if char_length(btrim(coalesce(p_rejection_reason, ''))) < 3 then
      raise exception 'Give a reason for the rejection (at least 3 characters).' using errcode = '22023';
    end if;
    update public.hr_leave_applications
    set status = 'REJECTED', decided_by = v_uid, decided_at = now(), rejection_reason = btrim(p_rejection_reason), updated_at = now()
    where id = p_id;
    perform private.log_attendance(null, 'LEAVE_REJECTED', 'hr_leave_application', p_id, v_app.user_id,
      jsonb_build_object('reason', btrim(p_rejection_reason)));
    return;
  end if;

  -- Re-count with today's holidays; check the balance excluding this application itself.
  v_days := private.hr_working_days(v_app.start_date, v_app.end_date);
  if v_days = 0 then
    raise exception 'These dates no longer contain working days (a holiday was added). Reject the application instead.' using errcode = '22023';
  end if;
  if (select uses_balance from public.hr_leave_policies where leave_type = v_app.leave_type) then
    v_year := extract(year from v_app.start_date)::int;
    v_available := private.hr_leave_allowance(v_app.user_id, v_app.leave_type, v_year)
                   - private.hr_leave_days(v_app.user_id, v_app.leave_type, v_year, 'APPROVED');
    if v_days > v_available then
      raise exception 'Not enough Casual Leave to approve: % day(s) available, % requested.', greatest(v_available, 0), v_days using errcode = '23514';
    end if;
  end if;

  update public.hr_leave_applications
  set status = 'APPROVED', decided_by = v_uid, decided_at = now(), working_days = v_days, updated_at = now()
  where id = p_id;
  perform private.log_attendance(null, 'LEAVE_APPROVED', 'hr_leave_application', p_id, v_app.user_id,
    jsonb_build_object('working_days', v_days));
end;
$$;

-- -----------------------------------------------------------------------------
-- Leave applications are work history (016/024): such employees are deactivated, not deleted.
-- -----------------------------------------------------------------------------
create or replace function private.profile_has_history(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.daily_reports where user_id = p_user_id)
      or exists (select 1 from public.time_entries where user_id = p_user_id)
      or exists (select 1 from public.task_assignees where user_id = p_user_id or assigned_by = p_user_id)
      or exists (select 1 from public.bug_reports where reported_by = p_user_id)
      or exists (select 1 from public.task_comments where user_id = p_user_id)
      or exists (select 1 from public.activity_logs where user_id = p_user_id)
      or exists (select 1 from public.tasks where created_by = p_user_id)
      or exists (select 1 from public.projects where owner_id = p_user_id or created_by = p_user_id)
      or exists (select 1 from public.clients where created_by = p_user_id)
      or exists (select 1 from public.task_attachments where uploaded_by = p_user_id)
      or exists (select 1 from public.meeting_links where created_by = p_user_id)
      or exists (select 1 from public.meeting_records where created_by = p_user_id)
      or exists (select 1 from public.workspaces where created_by = p_user_id)
      or exists (select 1 from public.attendance_sessions where user_id = p_user_id)
      or exists (select 1 from public.hr_leave_applications where user_id = p_user_id)
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function private.audit_hr_holiday(), private.audit_hr_leave_policy(), private.audit_hr_leave_allowance(),
  private.hr_working_days(date, date), private.hr_leave_allowance(uuid, public.hr_leave_type, integer),
  private.hr_leave_days(uuid, public.hr_leave_type, integer, public.hr_leave_status)
  from public, anon, authenticated;
revoke all on function public.hr_working_days(date, date), public.hr_leave_balance(uuid, integer),
  public.hr_apply_leave(public.hr_leave_type, date, date, text), public.hr_cancel_leave(uuid),
  public.hr_decide_leave(uuid, boolean, text)
  from public, anon;
grant execute on function public.hr_working_days(date, date), public.hr_leave_balance(uuid, integer),
  public.hr_apply_leave(public.hr_leave_type, date, date, text), public.hr_cancel_leave(uuid),
  public.hr_decide_leave(uuid, boolean, text)
  to authenticated;
