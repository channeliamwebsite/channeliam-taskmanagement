-- =============================================================================
-- 033_attendance_breaks_and_policy.sql   (new tables and functions; changes
-- check-in to one session per day; no data changes)
--
-- Attendance & HR module, phase 2 (decided 2026-11-03):
--   * Breaks: an employee who is checked in can start and end breaks; several
--     breaks a day are allowed and added up. A break always belongs to the
--     open session and never overlaps another break. Times come from the
--     database clock, as for check-in/out (024).
--   * One attendance session per day: after checking out, checking in again
--     the same local day is refused. Days that already have several sessions
--     (recorded under 024) are kept as they are and still count.
--   * Checking out ends a break that is still running, at the check-out time.
--   * Company-wide working-hours policy (one row): a 9-hour day (540 min)
--     including a 45-minute break allowance, i.e. 8 h 15 m net; weekly off
--     Sunday; Asia/Kolkata. Only super admins change it; every change is
--     written to attendance_audit_log.
-- Access follows 024: employees read their own rows, super admins read all
-- (private.is_super_admin()), workspace admins get nothing extra; writes only
-- through the SECURITY DEFINER functions; deactivated accounts get nothing
-- (restrictive policies, as in 032).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit actions used by the HR module
-- -----------------------------------------------------------------------------
alter table public.attendance_audit_log drop constraint if exists attendance_audit_log_action_check;
alter table public.attendance_audit_log add constraint attendance_audit_log_action_check
  check (action in ('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END', 'SETTINGS_UPDATED'));

-- -----------------------------------------------------------------------------
-- Working-hours policy (single company-wide row)
-- -----------------------------------------------------------------------------
create table if not exists public.hr_settings (
  id                      boolean primary key default true check (id),
  scheduled_minutes       integer not null default 540 check (scheduled_minutes between 60 and 1440),
  break_allowance_minutes integer not null default 45 check (break_allowance_minutes between 0 and 480),
  weekly_off_days         smallint[] not null default '{0}' check (weekly_off_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  timezone                text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references public.profiles (id) on delete set null,
  constraint hr_settings_break_within_day check (break_allowance_minutes < scheduled_minutes)
);

comment on table public.hr_settings is
  'Company-wide attendance policy (one row). weekly_off_days: 0 = Sunday ... 6 = Saturday. Net working day = scheduled_minutes - break_allowance_minutes.';

insert into public.hr_settings (id) values (true) on conflict (id) do nothing;

create or replace function private.audit_hr_settings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  perform private.log_attendance(null, 'SETTINGS_UPDATED', 'hr_settings', null, null,
    jsonb_build_object(
      'before', jsonb_build_object('scheduled_minutes', old.scheduled_minutes, 'break_allowance_minutes', old.break_allowance_minutes,
                                   'weekly_off_days', old.weekly_off_days, 'timezone', old.timezone),
      'after',  jsonb_build_object('scheduled_minutes', new.scheduled_minutes, 'break_allowance_minutes', new.break_allowance_minutes,
                                   'weekly_off_days', new.weekly_off_days, 'timezone', new.timezone)));
  return new;
end;
$$;

drop trigger if exists audit_hr_settings on public.hr_settings;
create trigger audit_hr_settings before update on public.hr_settings
  for each row execute function private.audit_hr_settings();

alter table public.hr_settings enable row level security;
drop policy if exists "hr_settings: active employees read" on public.hr_settings;
create policy "hr_settings: active employees read"
  on public.hr_settings for select to authenticated
  using ((select private.current_user_role()) is not null);
drop policy if exists "hr_settings: super admins update" on public.hr_settings;
create policy "hr_settings: super admins update"
  on public.hr_settings for update to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

revoke all on public.hr_settings from public, anon, authenticated;
grant select on public.hr_settings to authenticated;
grant update (scheduled_minutes, break_allowance_minutes, weekly_off_days, timezone) on public.hr_settings to authenticated;
revoke all on function private.audit_hr_settings() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Breaks
-- -----------------------------------------------------------------------------
create table if not exists public.attendance_breaks (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.attendance_sessions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,                 -- null = still on break
  created_at  timestamptz not null default now(),
  constraint attendance_breaks_range_check check (ended_at is null or ended_at >= started_at),
  constraint attendance_breaks_no_overlap exclude using gist (
    user_id with =,
    tstzrange(started_at, ended_at, '[)') with &&
  )
);

comment on table public.attendance_breaks is
  'Breaks within an attendance session. Written only by attendance_start_break/_end_break and attendance_check_out; times come from the database clock.';

create unique index if not exists attendance_breaks_one_open_idx on public.attendance_breaks (user_id) where ended_at is null;
create index if not exists attendance_breaks_session_idx on public.attendance_breaks (session_id);

alter table public.attendance_breaks enable row level security;
drop policy if exists "attendance_breaks: own records and super admins" on public.attendance_breaks;
create policy "attendance_breaks: own records and super admins"
  on public.attendance_breaks for select to authenticated
  using (user_id = (select auth.uid()) or private.is_super_admin());
drop policy if exists "attendance_breaks: active accounts only" on public.attendance_breaks;
create policy "attendance_breaks: active accounts only"
  on public.attendance_breaks as restrictive for all to authenticated
  using ((select private.current_user_role()) is not null)
  with check ((select private.current_user_role()) is not null);

revoke all on public.attendance_breaks from public, anon, authenticated;
grant select on public.attendance_breaks to authenticated;

-- -----------------------------------------------------------------------------
-- Check-in: one session per local day (otherwise as in 024)
-- -----------------------------------------------------------------------------
create or replace function public.attendance_check_in(p_workspace_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_date date;
  v_id uuid;
begin
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Sign in with an active account to record attendance' using errcode = '42501';
  end if;
  if p_workspace_id is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'You can only record attendance in a workspace you belong to' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.attendance_sessions:' || v_uid::text));

  if exists (select 1 from public.attendance_sessions where user_id = v_uid and check_out_at is null) then
    raise exception 'You are already checked in. Check out first.' using errcode = '23505';
  end if;
  v_date := (now() at time zone private.workspace_timezone(p_workspace_id))::date;
  if exists (select 1 from public.attendance_sessions where user_id = v_uid and work_date = v_date) then
    raise exception 'You have already checked out today. Attendance allows one check-in per day.' using errcode = '23505';
  end if;

  insert into public.attendance_sessions (workspace_id, user_id, work_date, check_in_at)
  values (p_workspace_id, v_uid, v_date, now())
  returning id into v_id;

  perform private.log_attendance(p_workspace_id, 'CHECK_IN', 'attendance_session', v_id, v_uid);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Check-out: also ends a running break (otherwise as in 024)
-- -----------------------------------------------------------------------------
create or replace function public.attendance_check_out()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.attendance_sessions;
  v_break public.attendance_breaks;
begin
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Sign in with an active account to record attendance' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.attendance_sessions:' || v_uid::text));

  select * into v_session
  from public.attendance_sessions
  where user_id = v_uid and check_out_at is null
  for update;
  if not found then
    raise exception 'You are not checked in.' using errcode = '23514';
  end if;

  update public.attendance_breaks
  set ended_at = greatest(now(), started_at)
  where user_id = v_uid and ended_at is null
  returning * into v_break;
  if found then
    perform private.log_attendance(
      v_session.workspace_id, 'BREAK_END', 'attendance_break', v_break.id, v_uid,
      jsonb_build_object('minutes', floor(extract(epoch from (v_break.ended_at - v_break.started_at)) / 60)::int, 'ended_by', 'check_out'));
  end if;

  update public.attendance_sessions
  set check_out_at = greatest(now(), check_in_at)
  where id = v_session.id
  returning * into v_session;

  perform private.log_attendance(
    v_session.workspace_id, 'CHECK_OUT', 'attendance_session', v_session.id, v_uid,
    jsonb_build_object('minutes', floor(extract(epoch from (v_session.check_out_at - v_session.check_in_at)) / 60)::int));
  return v_session.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Start / end break (same per-person lock as check-in/out)
-- -----------------------------------------------------------------------------
create or replace function public.attendance_start_break()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.attendance_sessions;
  v_id uuid;
begin
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Sign in with an active account to record attendance' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.attendance_sessions:' || v_uid::text));

  select * into v_session
  from public.attendance_sessions
  where user_id = v_uid and check_out_at is null
  for update;
  if not found then
    raise exception 'Check in before starting a break.' using errcode = '23514';
  end if;
  if exists (select 1 from public.attendance_breaks where user_id = v_uid and ended_at is null) then
    raise exception 'You are already on a break.' using errcode = '23505';
  end if;

  insert into public.attendance_breaks (session_id, user_id, started_at)
  values (v_session.id, v_uid, greatest(now(), v_session.check_in_at))
  returning id into v_id;

  perform private.log_attendance(v_session.workspace_id, 'BREAK_START', 'attendance_break', v_id, v_uid);
  return v_id;
end;
$$;

create or replace function public.attendance_end_break()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_break public.attendance_breaks;
  v_workspace uuid;
begin
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Sign in with an active account to record attendance' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.attendance_sessions:' || v_uid::text));

  select * into v_break
  from public.attendance_breaks
  where user_id = v_uid and ended_at is null
  for update;
  if not found then
    raise exception 'You are not on a break.' using errcode = '23514';
  end if;

  update public.attendance_breaks
  set ended_at = greatest(now(), started_at)
  where id = v_break.id
  returning * into v_break;

  select workspace_id into v_workspace from public.attendance_sessions where id = v_break.session_id;
  perform private.log_attendance(
    v_workspace, 'BREAK_END', 'attendance_break', v_break.id, v_uid,
    jsonb_build_object('minutes', floor(extract(epoch from (v_break.ended_at - v_break.started_at)) / 60)::int));
  return v_break.id;
end;
$$;

revoke all on function public.attendance_start_break(), public.attendance_end_break() from public, anon;
grant execute on function public.attendance_start_break(), public.attendance_end_break() to authenticated;
