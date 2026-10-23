-- Migration 010: daily_reports can no longer be written directly by clients.
-- Valid only after 010 (009 is a prerequisite). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres)
insert into auth.users (id, email, raw_user_meta_data) values
  ('5e000000-0000-4000-8000-000000000001', 'owner@rl.test', '{"full_name":"Owner"}'),
  ('5e000000-0000-4000-8000-000000000002', 'admin@rl.test', '{"full_name":"Admin"}'),
  ('5e000000-0000-4000-8000-000000000003', 'super@rl.test', '{"full_name":"Super"}'),
  ('5e000000-0000-4000-8000-000000000004', 'colleague@rl.test', '{"full_name":"Colleague"}');
update public.profiles set role = 'SUPER_ADMIN' where id = '5e000000-0000-4000-8000-000000000003';
update public.profiles set role = 'ADMIN' where id = '5e000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by) values
  ('6f000000-0000-4000-8000-000000000001', 'RL', '5e000000-0000-4000-8000-000000000003');
insert into public.workspace_members (workspace_id, user_id) values
  ('6f000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001'),
  ('6f000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000002'),
  ('6f000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000004');
-- A historical report (written before the lock-down).
insert into public.daily_reports (id, user_id, workspace_id, report_date, accomplishments, evening_submitted_at)
values ('7a000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001',
        '6f000000-0000-4000-8000-000000000001', '2026-01-15', 'Legacy work', '2026-01-15 18:00:00+05:30');

-- Privileges as the migration's self-check describes them
select ok(not has_table_privilege('authenticated', 'public.daily_reports', 'INSERT, UPDATE, DELETE'),
  'authenticated has no table-level write privilege');
select ok(not has_any_column_privilege('authenticated', 'public.daily_reports', 'INSERT, UPDATE'),
  'authenticated has no column-level write privilege');
select ok(has_table_privilege('authenticated', 'public.daily_reports', 'SELECT'), 'authenticated keeps SELECT');
select ok(not exists (select 1 from pg_policies where tablename = 'daily_reports' and cmd = 'DELETE'),
  'no delete policy remains on daily_reports');

set local role authenticated;

-- Owner: no direct writes of any kind; submission through the function still works
set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$
  insert into public.daily_reports (user_id, workspace_id, report_date)
  values ('5e000000-0000-4000-8000-000000000001', '6f000000-0000-4000-8000-000000000001', '2026-01-01')
$$, '42501', null, 'owners cannot insert report rows directly (e.g. backdated)');
select throws_ok($$
  update public.daily_reports set report_date = '2026-01-02' where id = '7a000000-0000-4000-8000-000000000001'
$$, '42501', null, 'owners cannot move a report to another date');
select throws_ok($$
  update public.daily_reports set evening_submitted_at = now(), morning_submitted_at = now() where id = '7a000000-0000-4000-8000-000000000001'
$$, '42501', null, 'owners cannot overwrite submission times');
select throws_ok($$
  update public.daily_reports set accomplishments = 'rewritten', tasks_completed = 9 where id = '7a000000-0000-4000-8000-000000000001'
$$, '42501', null, 'owners cannot rewrite a historical report or its counts');
select throws_ok($$
  delete from public.daily_reports where id = '7a000000-0000-4000-8000-000000000001'
$$, '42501', null, 'owners cannot delete reports');
select lives_ok($$ select public.submit_morning_plan('6f000000-0000-4000-8000-000000000001', 'Plan') $$,
  'owners can still submit a morning plan through the function');
select lives_ok($$ select public.submit_evening_report('6f000000-0000-4000-8000-000000000001', 1, 'Done') $$,
  'owners can still submit and resubmit an evening report through the function');
select is((select count(*)::int from public.daily_reports), 2, 'owner reads own reports (historical + today)');

-- Admin and colleague: no direct writes either
set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$
  update public.daily_reports set accomplishments = 'admin edit' where id = '7a000000-0000-4000-8000-000000000001'
$$, '42501', null, 'admins cannot edit an employee''s report');
select throws_ok($$
  delete from public.daily_reports where id = '7a000000-0000-4000-8000-000000000001'
$$, '42501', null, 'admins cannot delete an employee''s report');
select is((select count(*)::int from public.daily_reports where workspace_id = '6f000000-0000-4000-8000-000000000001'), 2,
  'admin still reads the workspace''s reports');
set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports where workspace_id = '6f000000-0000-4000-8000-000000000001'), 2,
  'super admin still reads the workspace''s reports');
set local request.jwt.claims to '{"sub":"5e000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$
  update public.daily_reports set morning_plan = 'tampered' where user_id = '5e000000-0000-4000-8000-000000000001'
$$, '42501', null, 'colleagues cannot write to another employee''s report');
select is((select count(*)::int from public.daily_reports where user_id = '5e000000-0000-4000-8000-000000000001'), 0,
  'colleagues still cannot read another employee''s report');

-- Anonymous callers: no table access and no function access
reset role;
set local request.jwt.claims to '';
set local role anon;
select throws_ok($$ select count(*) from public.daily_reports $$, '42501', null, 'anonymous callers cannot read reports');
select throws_ok($$ select public.submit_evening_report('6f000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anonymous callers cannot execute the submission functions');
reset role;

-- The historical row is unchanged by everything above
select is(
  (select format('%s|%s|%s', report_date, accomplishments, evening_submitted_at = '2026-01-15 18:00:00+05:30'::timestamptz)
   from public.daily_reports where id = '7a000000-0000-4000-8000-000000000001'),
  '2026-01-15|Legacy work|t', 'historical report unchanged');

select * from finish();
rollback;
