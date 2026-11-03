-- =============================================================================
-- 024_attendance_core.sql   (new tables; no changes to existing data)
--
-- Attendance, milestone 1: check-in / check-out sessions and their audit log.
-- Separate from task time tracking (time_entries), which is unchanged.
--
-- Scope (agreed role model for HR features):
--   * Every active employee (individual, admin, super admin) records their own
--     attendance in a workspace they belong to, and reads their own records.
--   * Super admins read attendance company-wide (all workspaces), unlike the
--     task features, which stay limited to their own workspaces.
--   * Workspace admins get no access to other people's attendance.
--
-- Integrity:
--   * Timestamps come from the database clock (now()); the client never sends
--     one. work_date is the local date of the check-in in the workspace's
--     timezone (default Asia/Kolkata).
--   * Rows are written only by public.attendance_check_in / _check_out
--     (SECURITY DEFINER); signed-in users have SELECT only, so original times
--     cannot be edited. Corrections (a later milestone) are separate records.
--   * A person has at most one open session across all workspaces, and their
--     sessions never overlap (exclusion constraint). Concurrent check-ins are
--     serialised by a per-user advisory lock; the constraints are the backstop.
--   * Attendance counts as work history, so 016 keeps such employees from
--     being deleted (deactivate instead).
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- attendance_sessions: raw check-in / check-out records
-- -----------------------------------------------------------------------------
create table public.attendance_sessions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  work_date     date not null,
  check_in_at   timestamptz not null default now(),
  check_out_at  timestamptz,                 -- null = still checked in
  created_at    timestamptz not null default now(),
  constraint attendance_sessions_range_check check (check_out_at is null or check_out_at >= check_in_at),
  constraint attendance_sessions_no_overlap exclude using gist (
    user_id with =,
    tstzrange(check_in_at, check_out_at, '[)') with &&
  )
);

comment on table public.attendance_sessions is
  'Attendance check-in/check-out records. Written only by attendance_check_in/_check_out; times come from the database clock.';

create unique index attendance_sessions_one_open_idx on public.attendance_sessions (user_id) where check_out_at is null;
create index attendance_sessions_user_date_idx on public.attendance_sessions (user_id, work_date);
create index attendance_sessions_workspace_date_idx on public.attendance_sessions (workspace_id, work_date);

-- -----------------------------------------------------------------------------
-- attendance_audit_log: who did what to attendance data
-- Kept apart from activity_logs, which workspace members and admins can read.
-- -----------------------------------------------------------------------------
create table public.attendance_audit_log (
  id              bigint generated always as identity primary key,
  workspace_id    uuid references public.workspaces (id) on delete cascade,
  actor_id        uuid references public.profiles (id) on delete set null,
  target_user_id  uuid references public.profiles (id) on delete set null,
  action          text not null check (action in ('CHECK_IN', 'CHECK_OUT')),
  record_type     text not null check (char_length(record_type) between 1 and 50),
  record_id       uuid,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index attendance_audit_log_target_idx on public.attendance_audit_log (target_user_id, created_at desc);
create index attendance_audit_log_record_idx on public.attendance_audit_log (record_type, record_id);

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- The caller is an active super admin (company-wide HR scope).
create or replace function private.is_super_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_user_role() = 'SUPER_ADMIN', false)
$$;

create or replace function private.log_attendance(
  p_workspace_id uuid,
  p_action text,
  p_record_type text,
  p_record_id uuid,
  p_target_user_id uuid,
  p_details jsonb default '{}'::jsonb
)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.attendance_audit_log (workspace_id, actor_id, target_user_id, action, record_type, record_id, details)
  values (p_workspace_id, (select auth.uid()), p_target_user_id, p_action, p_record_type, p_record_id, coalesce(p_details, '{}'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- Check-in / check-out (the only way to write attendance_sessions)
-- -----------------------------------------------------------------------------
create or replace function public.attendance_check_in(p_workspace_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Sign in with an active account to record attendance' using errcode = '42501';
  end if;
  if p_workspace_id is null or not private.is_workspace_member(p_workspace_id) then
    raise exception 'You can only record attendance in a workspace you belong to' using errcode = '42501';
  end if;

  -- One check-in or check-out per person at a time.
  perform pg_advisory_xact_lock(hashtext('public.attendance_sessions:' || v_uid::text));

  if exists (select 1 from public.attendance_sessions where user_id = v_uid and check_out_at is null) then
    raise exception 'You are already checked in. Check out first.' using errcode = '23505';
  end if;

  insert into public.attendance_sessions (workspace_id, user_id, work_date, check_in_at)
  values (p_workspace_id, v_uid, (now() at time zone private.workspace_timezone(p_workspace_id))::date, now())
  returning id into v_id;

  perform private.log_attendance(p_workspace_id, 'CHECK_IN', 'attendance_session', v_id, v_uid);
  return v_id;
end;
$$;

create or replace function public.attendance_check_out()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.attendance_sessions;
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
-- Work history (016): attendance records also protect an employee from deletion
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
$$;

-- -----------------------------------------------------------------------------
-- RLS and grants: read-only for signed-in users
-- -----------------------------------------------------------------------------
alter table public.attendance_sessions enable row level security;
alter table public.attendance_audit_log enable row level security;

create policy "attendance_sessions: own records and super admins"
  on public.attendance_sessions for select to authenticated
  using (user_id = (select auth.uid()) or private.is_super_admin());

create policy "attendance_audit_log: own entries and super admins"
  on public.attendance_audit_log for select to authenticated
  using (target_user_id = (select auth.uid()) or private.is_super_admin());

revoke all on public.attendance_sessions, public.attendance_audit_log from public, anon, authenticated;
grant select on public.attendance_sessions, public.attendance_audit_log to authenticated;

-- is_super_admin is used by the policies above, so signed-in users need it
-- (like the other private policy helpers, 002); log_attendance is internal.
revoke all on function private.is_super_admin() from public, anon;
grant execute on function private.is_super_admin() to authenticated;
revoke all on function private.log_attendance(uuid, text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.profile_has_history(uuid) from public, anon, authenticated;
revoke all on function public.attendance_check_in(uuid), public.attendance_check_out() from public, anon;
grant execute on function public.attendance_check_in(uuid), public.attendance_check_out() to authenticated;
