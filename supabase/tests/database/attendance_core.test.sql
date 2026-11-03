-- Attendance check-in / check-out and access (migration 024).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres, no user). W1: sa (super admin), ad (admin), iv, iv2.
-- W2: ot (individual). sa2 = super admin in no workspace.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e1000000-0000-4000-8000-000000000001', 'sa@att.test', '{"full_name":"SA"}'),
  ('e1000000-0000-4000-8000-000000000002', 'ad@att.test', '{"full_name":"AD"}'),
  ('e1000000-0000-4000-8000-000000000003', 'iv@att.test', '{"full_name":"IV"}'),
  ('e1000000-0000-4000-8000-000000000004', 'iv2@att.test', '{"full_name":"IV2"}'),
  ('e1000000-0000-4000-8000-000000000005', 'ot@att.test', '{"full_name":"OT"}'),
  ('e1000000-0000-4000-8000-000000000006', 'sa2@att.test', '{"full_name":"SA2"}');
update public.profiles set role = 'SUPER_ADMIN'
where id in ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000006');
update public.profiles set role = 'ADMIN' where id = 'e1000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by, timezone) values
  ('e2000000-0000-4000-8000-000000000001', 'W1', 'e1000000-0000-4000-8000-000000000001', 'Asia/Kolkata'),
  ('e2000000-0000-4000-8000-000000000002', 'W2', 'e1000000-0000-4000-8000-000000000001', 'America/New_York');
insert into public.workspace_members (workspace_id, user_id) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002'),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003'),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000005');

-- ---------------------------------------------------------------------------
-- Check-in / check-out by an individual
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.attendance_check_out() $$,
  '23514', 'You are not checked in.', 'check-out without an active check-in is refused');
select lives_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000001') $$, 'iv checks in to W1');
select throws_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000001') $$,
  '23505', 'You are already checked in. Check out first.', 'a second check-in is refused');
select throws_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000002') $$,
  '23505', null, 'including in another workspace (one open session overall)');
select is((select count(*)::int from public.attendance_sessions where check_out_at is null), 1, 'iv sees one open session');
select ok((select check_in_at = now() and work_date = (now() at time zone 'Asia/Kolkata')::date
           from public.attendance_sessions where check_out_at is null),
  'the check-in time is the database clock and work_date is the Asia/Kolkata date');

-- Original times cannot be changed or forged directly.
select throws_ok($$ update public.attendance_sessions set check_in_at = now() - interval '3 hours' $$,
  '42501', null, 'the check-in time cannot be edited');
select throws_ok($$ insert into public.attendance_sessions (workspace_id, user_id, work_date, check_in_at, check_out_at)
                   values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', current_date,
                           now() - interval '9 hours', now()) $$,
  '42501', null, 'a session cannot be inserted directly');
select throws_ok($$ delete from public.attendance_sessions $$, '42501', null, 'nor deleted');
select throws_ok($$ insert into public.attendance_audit_log (action, record_type) values ('CHECK_IN', 'x') $$,
  '42501', null, 'the audit log cannot be written directly');

select lives_ok($$ select public.attendance_check_out() $$, 'iv checks out');
select is((select count(*)::int from public.attendance_sessions where check_out_at is null), 0, 'no session is open after check-out');
select throws_ok($$ select public.attendance_check_out() $$, '23514', null, 'a second check-out is refused');
-- Since 033 (decided 2026-11-03) there is one session per day: checking in
-- again after checking out the same day is refused.
select throws_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000001') $$,
  '23505', 'You have already checked out today. Attendance allows one check-in per day.',
  'checking in again after checking out the same day is refused (one session per day, 033)');
select is((select count(*)::int from public.attendance_sessions), 1, 'iv still has one session');
select is((select string_agg(action, ',' order by id) from public.attendance_audit_log),
  'CHECK_IN,CHECK_OUT', 'each check-in and check-out is in iv''s audit history');
select is((select count(*)::int from public.attendance_audit_log where actor_id is distinct from 'e1000000-0000-4000-8000-000000000003'), 0,
  'with iv as the actor');

-- Membership is required.
set local request.jwt.claims to '{"sub":"e1000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000002') $$,
  '42501', 'You can only record attendance in a workspace you belong to', 'iv2 cannot check in to a workspace they are not in');
select throws_ok($$ select public.attendance_check_in(null) $$, '42501', null, 'nor without a workspace');
select lives_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000001') $$, 'iv2 checks in to W1');

-- ---------------------------------------------------------------------------
-- Visibility: own records; super admins company-wide; admins only their own
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.attendance_sessions), 1, 'iv2 sees only their own session');
select is((select count(*)::int from public.attendance_audit_log), 1, 'and only their own audit entry');

set local request.jwt.claims to '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.attendance_sessions), 0, 'a workspace admin cannot see their members'' attendance');
select is((select count(*)::int from public.attendance_audit_log), 0, 'nor their attendance audit history');
select lives_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000001') $$, 'admins record their own attendance');
select is((select count(*)::int from public.attendance_sessions), 1, 'and see only that');
select lives_ok($$ select public.attendance_check_out() $$, 'the admin checks out');

set local request.jwt.claims to '{"sub":"e1000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.attendance_sessions), 0, 'another workspace''s member sees nothing');

set local request.jwt.claims to '{"sub":"e1000000-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.attendance_sessions where user_id in (
  'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004')), 3,
  'a super admin sees attendance company-wide, even outside their workspaces (one session each since 033)');
select ok((select count(*) from public.attendance_audit_log) >= 6, 'and the whole attendance audit log');
select throws_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'but records their own attendance only where they are a member');
select throws_ok($$ update public.attendance_sessions set check_out_at = now() $$, '42501', null,
  'and cannot edit anyone''s times directly either');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Database invariants (the backstop for the functions)
-- ---------------------------------------------------------------------------
select throws_ok($$ insert into public.attendance_sessions (workspace_id, user_id, work_date)
                   values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', current_date) $$,
  null, null, 'a second open session is impossible even for trusted writes');
-- ...0004 still has an open session, so a closed one spanning now overlaps it.
select throws_ok($$ insert into public.attendance_sessions (workspace_id, user_id, work_date, check_in_at, check_out_at)
                   values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000004', current_date,
                           now() - interval '1 minute', now() + interval '1 hour') $$,
  '23P01', null, 'overlapping sessions are impossible');
select throws_ok($$ insert into public.attendance_sessions (workspace_id, user_id, work_date, check_in_at, check_out_at)
                   values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000005', current_date,
                           now(), now() - interval '1 hour') $$,
  '23514', null, 'check-out before check-in is impossible');
select lives_ok($$ insert into public.attendance_sessions (workspace_id, user_id, work_date, check_in_at, check_out_at)
                  values ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003', current_date - 1,
                          now() - interval '30 hours', now() - interval '22 hours') $$,
  'a non-overlapping earlier session is fine');

-- Deactivated users cannot record attendance.
update public.profiles set is_active = false where id = 'e1000000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select public.attendance_check_out() $$, '42501', null, 'a deactivated employee cannot check out');
reset role;
set local request.jwt.claims to '';

-- Attendance is work history (016).
select ok(private.profile_has_history('e1000000-0000-4000-8000-000000000003'), 'attendance counts as work history');
select throws_ok($$ delete from auth.users where id = 'e1000000-0000-4000-8000-000000000003' $$, '55000', null,
  'so an employee with attendance cannot be deleted');

-- Timezone: work_date follows the workspace timezone.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1000000-0000-4000-8000-000000000005","role":"authenticated"}';
select lives_ok($$ select public.attendance_check_in('e2000000-0000-4000-8000-000000000002') $$, 'ot checks in to W2 (New York)');
select is((select work_date from public.attendance_sessions where check_out_at is null),
  (now() at time zone 'America/New_York')::date, 'work_date is the New York date there');
reset role;
set local request.jwt.claims to '';

select * from finish();
rollback;
