-- Migration 009: report submission functions (date, first times, snapshot, counts).
-- Valid at stage 009 and after 010. The 010 lock-down is in report_lockdown.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
--   W  = UTC+14 workspace, W2 = UTC-11 workspace (always a different local date),
--   W3 = invalid timezone (falls back to Asia/Kolkata)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('1a000000-0000-4000-8000-000000000001', 'owner@ri.test', '{"full_name":"Owner"}'),
  ('1a000000-0000-4000-8000-000000000002', 'admin@ri.test', '{"full_name":"Admin"}'),
  ('1a000000-0000-4000-8000-000000000003', 'super@ri.test', '{"full_name":"Super"}'),
  ('1a000000-0000-4000-8000-000000000004', 'colleague@ri.test', '{"full_name":"Colleague"}'),
  ('1a000000-0000-4000-8000-000000000005', 'inactive@ri.test', '{"full_name":"Inactive"}'),
  ('1a000000-0000-4000-8000-000000000006', 'outsider@ri.test', '{"full_name":"Outsider"}');
update public.profiles set role = 'SUPER_ADMIN' where id = '1a000000-0000-4000-8000-000000000003';
update public.profiles set role = 'ADMIN' where id = '1a000000-0000-4000-8000-000000000002';
update public.profiles set team = 'Creatives' where id = '1a000000-0000-4000-8000-000000000001';

insert into public.workspaces (id, name, created_by, timezone) values
  ('2b000000-0000-4000-8000-000000000001', 'RI plus14', '1a000000-0000-4000-8000-000000000003', 'Pacific/Kiritimati'),
  ('2b000000-0000-4000-8000-000000000002', 'RI minus11', '1a000000-0000-4000-8000-000000000003', 'Pacific/Pago_Pago'),
  ('2b000000-0000-4000-8000-000000000003', 'RI badzone', '1a000000-0000-4000-8000-000000000003', 'Not/AZone');
insert into public.workspace_members (workspace_id, user_id) values
  ('2b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001'),
  ('2b000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000001'),
  ('2b000000-0000-4000-8000-000000000003', '1a000000-0000-4000-8000-000000000001'),
  ('2b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000002'),
  ('2b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000004'),
  ('2b000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000005'),
  ('2b000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000006');
update public.profiles set is_active = false where id = '1a000000-0000-4000-8000-000000000005';

-- Tasks: A open, B blocked, C completed (all the owner's, in W); X is a
-- colleague's task in W; Y is the owner's task in another workspace.
insert into public.tasks (id, project_id, title, status) values
  ('3c000000-0000-4000-8000-000000000001', (select id from public.projects where workspace_id = '2b000000-0000-4000-8000-000000000001' and is_default), 'Open task', 'TODO'),
  ('3c000000-0000-4000-8000-000000000002', (select id from public.projects where workspace_id = '2b000000-0000-4000-8000-000000000001' and is_default), 'Blocked task', 'BLOCKED'),
  ('3c000000-0000-4000-8000-000000000003', (select id from public.projects where workspace_id = '2b000000-0000-4000-8000-000000000001' and is_default), 'Done task', 'COMPLETED'),
  ('3c000000-0000-4000-8000-000000000004', (select id from public.projects where workspace_id = '2b000000-0000-4000-8000-000000000001' and is_default), 'Colleague task', 'TODO'),
  ('3c000000-0000-4000-8000-000000000005', (select id from public.projects where workspace_id = '2b000000-0000-4000-8000-000000000002' and is_default), 'Other workspace task', 'TODO');
insert into public.task_assignees (task_id, user_id) values
  ('3c000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001'),
  ('3c000000-0000-4000-8000-000000000002', '1a000000-0000-4000-8000-000000000001'),
  ('3c000000-0000-4000-8000-000000000003', '1a000000-0000-4000-8000-000000000001'),
  ('3c000000-0000-4000-8000-000000000004', '1a000000-0000-4000-8000-000000000004'),
  ('3c000000-0000-4000-8000-000000000005', '1a000000-0000-4000-8000-000000000001');

-- A historical report from before migration 009 (no snapshot, no reporter_team).
insert into public.daily_reports (id, user_id, workspace_id, report_date, accomplishments, tasks_completed, evening_submitted_at)
values ('4d000000-0000-4000-8000-000000000001', '1a000000-0000-4000-8000-000000000001',
        '2b000000-0000-4000-8000-000000000001', '2026-01-15', 'Legacy work', 2, '2026-01-15 18:00:00+05:30');

-- ---------------------------------------------------------------------------
-- Morning plan: date from the workspace timezone; only the caller's own tasks
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(
  public.submit_morning_plan('2b000000-0000-4000-8000-000000000001', '  Plan  ',
    array['3c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000002',
          '3c000000-0000-4000-8000-000000000004', '3c000000-0000-4000-8000-000000000005',
          '3c000000-0000-4000-8000-000000000001']::uuid[]),
  (now() at time zone 'Pacific/Kiritimati')::date,
  'morning plan is dated today in the workspace timezone (UTC+14)');
select is(
  public.submit_morning_plan('2b000000-0000-4000-8000-000000000002', null, '{}'),
  (now() at time zone 'Pacific/Pago_Pago')::date,
  'another workspace uses its own timezone (UTC-11)');
select isnt((now() at time zone 'Pacific/Kiritimati')::date, (now() at time zone 'Pacific/Pago_Pago')::date,
  'the two workspaces are on different local dates, so the timezone really decided');
select is(
  public.submit_morning_plan('2b000000-0000-4000-8000-000000000003', null, '{}'),
  (now() at time zone 'Asia/Kolkata')::date,
  'an invalid workspace timezone falls back to Asia/Kolkata');

select is(
  (select planned_task_ids from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  array['3c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000002']::uuid[],
  'planned tasks keep only the caller''s own tasks in that workspace, de-duplicated, in order');
select is(
  (select morning_plan from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  'Plan', 'notes are trimmed');
select is(
  (select reporter_team from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  'Creatives', 'department at submission is recorded');

-- Resubmitting keeps the first submission time (pre-dated here so the check
-- is meaningful inside one transaction, where now() does not advance).
reset role;
set local request.jwt.claims to '';
update public.daily_reports set morning_submitted_at = '2020-01-01 09:00:00+00'
where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date;
set local role authenticated;
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$
  select public.submit_morning_plan('2b000000-0000-4000-8000-000000000001', 'Plan v2', array['3c000000-0000-4000-8000-000000000002']::uuid[])
$$, 'morning plan can be resubmitted the same day');
select is(
  (select morning_submitted_at from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  '2020-01-01 09:00:00+00'::timestamptz, 'resubmission keeps the first morning submission time');
select is(
  (select morning_plan || ' / ' || array_length(planned_task_ids, 1) from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  'Plan v2 / 1', 'resubmission replaces the plan content');

-- ---------------------------------------------------------------------------
-- Evening report: server-built snapshot and counts
-- ---------------------------------------------------------------------------
select lives_ok($$
  select public.submit_evening_report('2b000000-0000-4000-8000-000000000001', 7.5, 'Did things', null, 'Waiting on client', 'Next steps',
    array['3c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000002',
          '3c000000-0000-4000-8000-000000000003', '3c000000-0000-4000-8000-000000000004']::uuid[])
$$, 'evening report is submitted through the function');
select is(
  (select jsonb_path_query_array(evening_snapshot, '$.tasks[*].title') from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  '["Open task", "Blocked task", "Done task"]'::jsonb,
  'snapshot holds the caller''s own reported tasks only (colleague task dropped)');
select is(
  (select jsonb_path_query_array(evening_snapshot, '$.tasks[*].status') from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  '["TODO", "BLOCKED", "COMPLETED"]'::jsonb, 'snapshot records each task''s status at submission');
select ok(
  (select evening_snapshot #>> '{tasks,2,completed_at}' is not null and evening_snapshot ->> 'reporter_team' = 'Creatives'
          and evening_snapshot ->> 'version' = '1' and evening_snapshot ->> 'timezone' = 'Pacific/Kiritimati'
   from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  'snapshot records completion time, department, version and timezone');
select is(
  (select format('%s/%s/%s/%s', tasks_completed, tasks_in_progress, tasks_blocked, total_hours) from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  '1/1/1/7.50', 'counts are derived from the snapshot tasks (completed today / open / blocked)');
select is(
  (select evening_submitted_at from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  now(), 'evening submission time is set by the database');
select is(
  (select morning_plan from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  'Plan v2', 'the evening report completes the same row without touching the morning plan');

-- Resubmission keeps the first evening time and the first recorded department.
reset role;
set local request.jwt.claims to '';
update public.daily_reports set evening_submitted_at = '2020-01-01 18:00:00+00'
where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date;
update public.profiles set team = 'News Desk' where id = '1a000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$
  select public.submit_evening_report('2b000000-0000-4000-8000-000000000001', 8, 'Updated', null, null, null,
    array['3c000000-0000-4000-8000-000000000001']::uuid[])
$$, 'evening report can be resubmitted the same day');
select is(
  (select format('%s|%s|%s', evening_submitted_at = '2020-01-01 18:00:00+00'::timestamptz, reporter_team, jsonb_array_length(evening_snapshot -> 'tasks'))
   from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  't|Creatives|1', 'resubmission keeps the first time and first department, and replaces the snapshot');

-- Later task changes do not alter the stored snapshot.
reset role;
set local request.jwt.claims to '';
update public.tasks set title = 'Renamed later', status = 'COMPLETED' where id = '3c000000-0000-4000-8000-000000000001';
select is(
  (select evening_snapshot #>> '{tasks,0,title}' || ' / ' || (evening_snapshot #>> '{tasks,0,status}') from public.daily_reports
   where workspace_id = '2b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Pacific/Kiritimati')::date),
  'Open task / TODO', 'snapshot is unaffected by later task edits');

-- ---------------------------------------------------------------------------
-- Validation and callers that must be rejected
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.submit_evening_report('2b000000-0000-4000-8000-000000000001', 25) $$,
  '22023', null, 'hours outside 0-24 are rejected');
select throws_ok($$ select public.submit_morning_plan('2b000000-0000-4000-8000-000000000001', repeat('x', 10001)) $$,
  '22001', null, 'over-long text is rejected');

set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select public.submit_morning_plan('2b000000-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'inactive users cannot submit');
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok($$ select public.submit_evening_report('2b000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'non-members cannot submit into the workspace');
set local request.jwt.claims to '{"role":"authenticated"}';
select throws_ok($$ select public.submit_morning_plan('2b000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'a request without a user id is rejected');
reset role;
set local request.jwt.claims to '';
set local role anon;
select throws_ok($$ select public.submit_morning_plan('2b000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anonymous callers cannot execute the submission functions');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select private.report_author('2b000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'internal helpers are not callable by clients');

-- ---------------------------------------------------------------------------
-- Server-owned columns cannot be written by clients (holds from 009 onwards;
-- the full direct-write lock-down is tested in report_lockdown.test.sql)
-- ---------------------------------------------------------------------------
select throws_ok($$
  update public.daily_reports set evening_snapshot = '{"version":1,"tasks":[]}' where workspace_id = '2b000000-0000-4000-8000-000000000001'
$$, '42501', null, 'owners cannot forge a snapshot');
select throws_ok($$
  update public.daily_reports set reporter_team = 'Forged' where workspace_id = '2b000000-0000-4000-8000-000000000001'
$$, '42501', null, 'owners cannot change the recorded department');
select throws_ok($$
  insert into public.daily_reports (user_id, workspace_id, report_date, evening_snapshot)
  values ('1a000000-0000-4000-8000-000000000001', '2b000000-0000-4000-8000-000000000001', '2026-01-03', '{"version":1,"tasks":[]}')
$$, '42501', null, 'owners cannot insert a forged snapshot');

-- ---------------------------------------------------------------------------
-- Read access is unchanged; historical rows stay readable
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.daily_reports), 4, 'owner reads all own reports (3 today + 1 historical)');
select is(
  (select format('%s|%s|%s', accomplishments, evening_snapshot is null, reporter_team is null)
   from public.daily_reports where id = '4d000000-0000-4000-8000-000000000001'),
  'Legacy work|t|t', 'historical report without a snapshot is readable and unchanged');
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports where workspace_id = '2b000000-0000-4000-8000-000000000001'), 2,
  'workspace admin still reads team reports (today + historical)');
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports where workspace_id = '2b000000-0000-4000-8000-000000000001'), 2,
  'super admin still reads workspace reports');
set local request.jwt.claims to '{"sub":"1a000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports), 0, 'colleagues still cannot read another employee''s reports');

select * from finish();
rollback;
