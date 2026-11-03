-- Attendance breaks, one session per day and the working-hours policy (033).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). W: sa (super admin), ad (admin), iv and iv2 (individuals).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('d3000000-0000-4000-8000-000000000001', 'sa@br.test', '{"full_name":"SA"}'),
  ('d3000000-0000-4000-8000-000000000002', 'ad@br.test', '{"full_name":"AD"}'),
  ('d3000000-0000-4000-8000-000000000003', 'iv@br.test', '{"full_name":"IV"}'),
  ('d3000000-0000-4000-8000-000000000004', 'iv2@br.test', '{"full_name":"IV2"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'd3000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id = 'd3000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by, timezone) values
  ('d4000000-0000-4000-8000-000000000001', 'BR', 'd3000000-0000-4000-8000-000000000001', 'Asia/Kolkata');
insert into public.workspace_members (workspace_id, user_id) values
  ('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001'),
  ('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000002'),
  ('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000003'),
  ('d4000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000004')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Policy row
-- ---------------------------------------------------------------------------
select is((select format('%s|%s|%s|%s', scheduled_minutes, break_allowance_minutes, weekly_off_days, timezone) from public.hr_settings),
  '540|45|{0}|Asia/Kolkata', 'the default policy is a 9 h day with a 45 min break, Sunday off, India time');
select throws_ok($$ insert into public.hr_settings (id) values (false) $$, null, null, 'there is only ever one policy row');
select throws_ok($$ update public.hr_settings set break_allowance_minutes = 600 $$, '23514', null, 'the break allowance must be shorter than the day');

-- ---------------------------------------------------------------------------
-- Breaks by an individual
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"d3000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.hr_settings), 1, 'employees can read the policy');
select throws_ok($$ select public.attendance_start_break() $$, '23514', 'Check in before starting a break.', 'a break needs a check-in');
select throws_ok($$ select public.attendance_end_break() $$, '23514', 'You are not on a break.', 'ending a break needs a break');
select lives_ok($$ select public.attendance_check_in('d4000000-0000-4000-8000-000000000001') $$, 'iv checks in');
select lives_ok($$ select public.attendance_start_break() $$, 'iv starts a break');
select throws_ok($$ select public.attendance_start_break() $$, '23505', 'You are already on a break.', 'a second break while on break is refused');
select ok((select started_at = now() and ended_at is null from public.attendance_breaks), 'the break start is the database clock');
select lives_ok($$ select public.attendance_end_break() $$, 'iv ends the break');
select throws_ok($$ select public.attendance_end_break() $$, '23514', 'You are not on a break.', 'ending it twice is refused');
select lives_ok($$ select public.attendance_start_break() $$, 'iv starts a second break');
select lives_ok($$ select public.attendance_end_break() $$, 'and ends it');
select is((select count(*)::int from public.attendance_breaks), 2, 'several breaks a day are recorded');
select is((select count(distinct session_id)::int from public.attendance_breaks), 1, 'all in iv''s one session');

-- Breaks cannot be written or forged directly.
select throws_ok($$ insert into public.attendance_breaks (session_id, user_id, started_at, ended_at)
                   values ((select id from public.attendance_sessions limit 1), 'd3000000-0000-4000-8000-000000000003', now() - interval '2 hours', now()) $$,
  '42501', null, 'a break cannot be inserted directly');
select throws_ok($$ update public.attendance_breaks set ended_at = started_at $$, '42501', null, 'nor edited');
select throws_ok($$ delete from public.attendance_breaks $$, '42501', null, 'nor deleted');
with u as (update public.hr_settings set break_allowance_minutes = 120 returning 1)
select is((select count(*)::int from u), 0, 'an individual cannot change the policy (no row matches the super-admin-only policy)');

-- Check-out ends a running break.
select lives_ok($$ select public.attendance_start_break() $$, 'iv starts a third break');
select lives_ok($$ select public.attendance_check_out() $$, 'and checks out while on break');
select is((select count(*)::int from public.attendance_breaks where ended_at is null), 0, 'checking out ends the running break');
select is((select details ->> 'ended_by' from public.attendance_audit_log where action = 'BREAK_END' order by id desc limit 1), 'check_out',
  'the audit log says the break was ended by the check-out');
select is((select string_agg(action, ',' order by id) from public.attendance_audit_log),
  'CHECK_IN,BREAK_START,BREAK_END,BREAK_START,BREAK_END,BREAK_START,BREAK_END,CHECK_OUT', 'every action is in iv''s audit history, in order');
select throws_ok($$ select public.attendance_start_break() $$, '23514', null, 'no break after checking out');
select throws_ok($$ select public.attendance_check_in('d4000000-0000-4000-8000-000000000001') $$,
  '23505', 'You have already checked out today. Attendance allows one check-in per day.', 'no second check-in the same day');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"d3000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.attendance_breaks), 0, 'another individual sees none of iv''s breaks');
set local request.jwt.claims to '{"sub":"d3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.attendance_breaks), 0, 'nor does a workspace admin');
with u as (update public.hr_settings set break_allowance_minutes = 120 returning 1)
select is((select count(*)::int from u), 0, 'an admin cannot change the policy');
set local request.jwt.claims to '{"sub":"d3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.attendance_breaks where user_id = 'd3000000-0000-4000-8000-000000000003'), 3, 'a super admin sees them');

-- A super admin changes the policy; the change is audited.
update public.hr_settings set break_allowance_minutes = 60;
reset role;
set local request.jwt.claims to '';
select is((select break_allowance_minutes from public.hr_settings), 60, 'a super admin can change the policy (and the earlier attempts changed nothing: 45 -> 60 below)');
select ok((select updated_by = 'd3000000-0000-4000-8000-000000000001' from public.hr_settings), 'with the super admin recorded as the editor');
select is((select (details -> 'before' ->> 'break_allowance_minutes') || '->' || (details -> 'after' ->> 'break_allowance_minutes')
           from public.attendance_audit_log where action = 'SETTINGS_UPDATED' order by id desc limit 1), '45->60',
  'and the old and new values are in the attendance audit log');

-- ---------------------------------------------------------------------------
-- Anonymous and deactivated callers
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select count(*) from public.attendance_breaks $$, '42501', null, 'anonymous callers cannot read breaks');
select throws_ok($$ select count(*) from public.hr_settings $$, '42501', null, 'nor the policy');
select throws_ok($$ select public.attendance_start_break() $$, '42501', null, 'nor start a break');
reset role;

update public.profiles set is_active = false where id = 'd3000000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claims to '{"sub":"d3000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select public.attendance_start_break() $$, '42501', null, 'a deactivated employee cannot start a break');
select is((select count(*)::int from public.hr_settings), 0, 'nor read the policy');
reset role;
set local request.jwt.claims to '';

select * from finish();
rollback;
