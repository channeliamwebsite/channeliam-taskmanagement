-- Migration 011: automatic morning reports and live daily tracking.
-- Requires 009 (and works with 010). Run with: npx supabase test db
-- now() is fixed within the test transaction, so the morning report is generated
-- "one second ago" to place the day's changes after it. More rules (completed
-- before the report, moved into today, timezones, late runs, timestamps) are in
-- report_tracking.test.sql.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). Workspace W uses Asia/Kolkata.
--   sa = super admin, u1 / u2 = employees, u3 = colleague (individual),
--   out = member of another workspace only
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8a000000-0000-4000-8000-000000000001', 'sa@ra.test', '{"full_name":"SA"}'),
  ('8a000000-0000-4000-8000-000000000002', 'u1@ra.test', '{"full_name":"U1"}'),
  ('8a000000-0000-4000-8000-000000000003', 'u2@ra.test', '{"full_name":"U2"}'),
  ('8a000000-0000-4000-8000-000000000004', 'u3@ra.test', '{"full_name":"U3"}'),
  ('8a000000-0000-4000-8000-000000000005', 'out@ra.test', '{"full_name":"OUT"}');
update public.profiles set role = 'SUPER_ADMIN' where id = '8a000000-0000-4000-8000-000000000001';
update public.profiles set team = 'Creatives' where id = '8a000000-0000-4000-8000-000000000002';

insert into public.workspaces (id, name, created_by, timezone) values
  ('9b000000-0000-4000-8000-000000000001', 'RA', '8a000000-0000-4000-8000-000000000001', 'Asia/Kolkata'),
  ('9b000000-0000-4000-8000-000000000002', 'RA other', '8a000000-0000-4000-8000-000000000005', 'Asia/Kolkata');
insert into public.workspace_members (workspace_id, user_id) values
  ('9b000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000002'),
  ('9b000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000003'),
  ('9b000000-0000-4000-8000-000000000001', '8a000000-0000-4000-8000-000000000004');

-- Tasks A-D are u1's work for today (scheduled today by default); F is for tomorrow.
insert into public.tasks (id, project_id, title, status) values
  ('7c000000-0000-4000-8000-00000000000a', (select id from public.projects where workspace_id = '9b000000-0000-4000-8000-000000000001' and is_default), 'Task A', 'TODO'),
  ('7c000000-0000-4000-8000-00000000000b', (select id from public.projects where workspace_id = '9b000000-0000-4000-8000-000000000001' and is_default), 'Task B', 'TODO'),
  ('7c000000-0000-4000-8000-00000000000c', (select id from public.projects where workspace_id = '9b000000-0000-4000-8000-000000000001' and is_default), 'Task C', 'TODO'),
  ('7c000000-0000-4000-8000-00000000000d', (select id from public.projects where workspace_id = '9b000000-0000-4000-8000-000000000001' and is_default), 'Task D', 'TODO');
insert into public.tasks (id, project_id, title, status, scheduled_date) values
  ('7c000000-0000-4000-8000-00000000000f', (select id from public.projects where workspace_id = '9b000000-0000-4000-8000-000000000001' and is_default),
   'Task F (tomorrow)', 'TODO', (now() at time zone 'Asia/Kolkata')::date + 1);
insert into public.task_assignees (task_id, user_id) values
  ('7c000000-0000-4000-8000-00000000000a', '8a000000-0000-4000-8000-000000000002'),
  ('7c000000-0000-4000-8000-00000000000b', '8a000000-0000-4000-8000-000000000002'),
  ('7c000000-0000-4000-8000-00000000000c', '8a000000-0000-4000-8000-000000000002'),
  ('7c000000-0000-4000-8000-00000000000d', '8a000000-0000-4000-8000-000000000002'),
  ('7c000000-0000-4000-8000-00000000000f', '8a000000-0000-4000-8000-000000000002');
-- These tasks existed before today's morning report.
update public.tasks set created_at = now() - interval '1 day' where id::text like '7c000000-%';

-- u1 writes their own morning notes before the automatic report runs.
set local role authenticated;
set local request.jwt.claims to '{"sub":"8a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.submit_morning_plan('9b000000-0000-4000-8000-000000000001', 'My own notes') $$,
  'employee notes submitted before the automatic report');
reset role;
set local request.jwt.claims to '';
create temp table notes_before as
  select morning_plan, morning_submitted_at from public.daily_reports
  where user_id = '8a000000-0000-4000-8000-000000000002' and workspace_id = '9b000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Schedule window: nothing before 09:00 local or on Sundays (without p_force)
-- ---------------------------------------------------------------------------
select is(private.generate_morning_reports('2026-10-19 08:00:00+05:30'), 0, 'no reports before 09:00 local time');
select is(private.generate_morning_reports('2026-10-18 10:00:00+05:30'), 0, 'no reports on Sunday');
select ok(private.generate_morning_reports('2026-10-19 10:00:00+05:30') >= 4, 'reports generated after 09:00 on a workday');

-- ---------------------------------------------------------------------------
-- 1, 2, 7, 8: today's automatic morning report
-- ---------------------------------------------------------------------------
select lives_ok($$ select private.generate_morning_reports(now() - interval '1 second', true, '9b000000-0000-4000-8000-000000000001') $$, 'the morning job runs');
select is(
  (select count(*)::int from public.daily_reports
   where workspace_id = '9b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Asia/Kolkata')::date
     and morning_snapshot is not null),
  4, 'one morning report per active member of W (sa, u1, u2, u3)');
select is(
  (select jsonb_path_query_array(morning_snapshot, '$.tasks[*].title') from public.daily_reports
   where user_id = '8a000000-0000-4000-8000-000000000002' and workspace_id = '9b000000-0000-4000-8000-000000000001'
     and report_date = (now() at time zone 'Asia/Kolkata')::date),
  '["Task A", "Task B", "Task C", "Task D"]'::jsonb,
  'morning report lists A-D (not tomorrow''s task F)');
select ok(
  (select morning_generated_at is not null and morning_snapshot #>> '{tasks,0,priority}' is not null and morning_snapshot #>> '{tasks,0,assigned_at}' is not null
   from public.daily_reports
   where user_id = '8a000000-0000-4000-8000-000000000002' and report_date = (now() at time zone 'Asia/Kolkata')::date
     and workspace_id = '9b000000-0000-4000-8000-000000000001'),
  'snapshot records generation time, priority and assignment time');
select is(
  (select format('%s|%s', r.morning_plan, r.morning_submitted_at = n.morning_submitted_at)
   from public.daily_reports r, notes_before n
   where r.user_id = '8a000000-0000-4000-8000-000000000002' and r.workspace_id = '9b000000-0000-4000-8000-000000000001'
     and r.report_date = (now() at time zone 'Asia/Kolkata')::date),
  'My own notes|t', 'employee notes and submission time are preserved');

create temp table snapshot_before as
  select user_id, morning_snapshot, morning_generated_at from public.daily_reports
  where workspace_id = '9b000000-0000-4000-8000-000000000001' and report_date = (now() at time zone 'Asia/Kolkata')::date;
select is(private.generate_morning_reports(now() + interval '15 minutes', true, '9b000000-0000-4000-8000-000000000001'), 0, 'a retry writes nothing');
select is(
  (select count(*)::int from public.daily_reports r join snapshot_before b using (user_id)
   where r.workspace_id = '9b000000-0000-4000-8000-000000000001' and r.report_date = (now() at time zone 'Asia/Kolkata')::date
     and r.morning_snapshot = b.morning_snapshot and r.morning_generated_at = b.morning_generated_at),
  4, 'a retry does not overwrite any morning snapshot');
select is(
  (select count(*)::int from public.daily_reports where workspace_id = '9b000000-0000-4000-8000-000000000001'
     and report_date = (now() at time zone 'Asia/Kolkata')::date),
  4, 'no duplicate report rows');

-- The super admin sees u1's report without u1 doing anything else.
set local role authenticated;
set local request.jwt.claims to '{"sub":"8a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select jsonb_array_length(morning_snapshot -> 'tasks') from public.daily_reports
   where user_id = '8a000000-0000-4000-8000-000000000002' and report_date = (now() at time zone 'Asia/Kolkata')::date
     and workspace_id = '9b000000-0000-4000-8000-000000000001'),
  4, 'the super admin can read the automatic morning report');
select is(
  (select string_agg(title || ':' || tracking, ',' order by title) from public.daily_tracking('9b000000-0000-4000-8000-000000000001')
   where user_id = '8a000000-0000-4000-8000-000000000002'),
  'Task A:MORNING,Task B:MORNING,Task C:MORNING,Task D:MORNING', 'tracking starts with the morning tasks');

-- ---------------------------------------------------------------------------
-- 3, 4, 5, 6: changes during the day
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims to '';
insert into public.tasks (id, project_id, title, status) values
  ('7c000000-0000-4000-8000-00000000000e', (select id from public.projects where workspace_id = '9b000000-0000-4000-8000-000000000001' and is_default), 'Task E', 'TODO');
insert into public.task_assignees (task_id, user_id) values ('7c000000-0000-4000-8000-00000000000e', '8a000000-0000-4000-8000-000000000002');
update public.tasks set status = 'COMPLETED' where id = '7c000000-0000-4000-8000-00000000000a';
update public.tasks set status = 'IN_PROGRESS' where id = '7c000000-0000-4000-8000-00000000000b';
update public.tasks set title = 'Task B (renamed)', priority = 'HIGH', description = 'edited' where id = '7c000000-0000-4000-8000-00000000000b';
-- Reassign D from u1 to u2.
delete from public.task_assignees where task_id = '7c000000-0000-4000-8000-00000000000d' and user_id = '8a000000-0000-4000-8000-000000000002';
insert into public.task_assignees (task_id, user_id) values ('7c000000-0000-4000-8000-00000000000d', '8a000000-0000-4000-8000-000000000003');

set local role authenticated;
set local request.jwt.claims to '{"sub":"8a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select string_agg(title || ':' || coalesce(status, '-') || ':' || tracking, ',' order by title)
   from public.daily_tracking('9b000000-0000-4000-8000-000000000001')
   where user_id = '8a000000-0000-4000-8000-000000000002'),
  'Task A:COMPLETED:MORNING,Task B (renamed):IN_PROGRESS:MORNING,Task C:TODO:MORNING,Task D:TODO:REASSIGNED,Task E:TODO:ADDED',
  'evening view: A completed, B in progress, C pending, D reassigned away, E created during the day');
select is(
  (select count(*)::int from public.daily_tracking('9b000000-0000-4000-8000-000000000001')
   where user_id = '8a000000-0000-4000-8000-000000000002' and task_id = '7c000000-0000-4000-8000-00000000000b'),
  1, 'editing a task does not duplicate it');
select is(
  (select morning_status from public.daily_tracking('9b000000-0000-4000-8000-000000000001')
   where user_id = '8a000000-0000-4000-8000-000000000002' and task_id = '7c000000-0000-4000-8000-00000000000a'),
  'TODO', 'the morning status is kept next to the current status');
select is(
  (select tracking from public.daily_tracking('9b000000-0000-4000-8000-000000000001')
   where user_id = '8a000000-0000-4000-8000-000000000003' and task_id = '7c000000-0000-4000-8000-00000000000d'),
  'ASSIGNED', 'the new assignee gets the reassigned task as assigned during the day (not created)');
reset role;
set local request.jwt.claims to '';
select is(
  (select jsonb_path_query_array(morning_snapshot, '$.tasks[*].title') from public.daily_reports
   where user_id = '8a000000-0000-4000-8000-000000000002' and workspace_id = '9b000000-0000-4000-8000-000000000001'
     and report_date = (now() at time zone 'Asia/Kolkata')::date),
  '["Task A", "Task B", "Task C", "Task D"]'::jsonb,
  'the morning snapshot is unchanged by the day''s edits');

-- ---------------------------------------------------------------------------
-- 9: access control
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"8a000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::int from public.daily_tracking('9b000000-0000-4000-8000-000000000001')
   where user_id <> '8a000000-0000-4000-8000-000000000004'),
  0, 'a colleague sees only their own tracking');
select is((select count(*)::int from public.daily_reports where user_id = '8a000000-0000-4000-8000-000000000002'), 0,
  'a colleague cannot read another employee''s report');
select throws_ok($$ select private.generate_morning_reports() $$, '42501', null, 'clients cannot run the report job');
select throws_ok($$
  update public.daily_reports set morning_snapshot = '{"version":1,"tasks":[]}' where user_id = '8a000000-0000-4000-8000-000000000004'
$$, '42501', null, 'clients cannot write a morning snapshot');
set local request.jwt.claims to '{"sub":"8a000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select * from public.daily_tracking('9b000000-0000-4000-8000-000000000001') $$, '42501', null,
  'members of another workspace are rejected');
reset role;
set local request.jwt.claims to '';
set local role anon;
select throws_ok($$ select * from public.daily_tracking('9b000000-0000-4000-8000-000000000001') $$, '42501', null,
  'anonymous callers cannot read tracking');
reset role;

select * from finish();
rollback;
