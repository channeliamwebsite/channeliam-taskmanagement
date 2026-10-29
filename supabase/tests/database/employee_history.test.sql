-- Employee history survives offboarding (migration 016).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres): sa = super admin, ad = admin, emp = individual with
-- work history, fresh = invited by mistake, never did anything.
insert into auth.users (id, email, raw_user_meta_data) values
  ('6a000000-0000-4000-8000-000000000001', 'sa@history.test', '{"full_name":"SA"}'),
  ('6a000000-0000-4000-8000-000000000002', 'ad@history.test', '{"full_name":"AD"}'),
  ('6a000000-0000-4000-8000-000000000003', 'emp@history.test', '{"full_name":"EMP"}'),
  ('6a000000-0000-4000-8000-000000000004', 'fresh@history.test', '{"full_name":"FRESH"}');
update public.profiles set role = 'SUPER_ADMIN' where id = '6a000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id = '6a000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by) values
  ('6b000000-0000-4000-8000-000000000001', 'H', '6a000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id) values
  ('6b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000002'),
  ('6b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003'),
  ('6b000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000004');
insert into public.tasks (id, project_id, title, status) values
  ('6c000000-0000-4000-8000-000000000001',
   (select id from public.projects where workspace_id = '6b000000-0000-4000-8000-000000000001' and is_default), 'Done work', 'TODO');
insert into public.task_assignees (task_id, user_id) values
  ('6c000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003');
insert into public.time_entries (task_id, user_id, started_at, ended_at) values
  ('6c000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000003', '2026-10-27 09:00+05:30', '2026-10-27 11:00+05:30');

-- emp's own work, done through the normal paths.
set local role authenticated;
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000003","role":"authenticated"}';
update public.tasks set status = 'IN_PROGRESS', progress = 50 where id = '6c000000-0000-4000-8000-000000000001';
insert into public.task_comments (task_id, comment) values ('6c000000-0000-4000-8000-000000000001', 'Finished');
select public.submit_evening_report('6b000000-0000-4000-8000-000000000001', 2, 'Finished the work');
insert into public.bug_reports (workspace_id, title, description) values ('6b000000-0000-4000-8000-000000000001', 'Bug', 'Steps');
reset role;
set local request.jwt.claims to '';
update public.tasks set status = 'COMPLETED', progress = 100 where id = '6c000000-0000-4000-8000-000000000001';

create temporary table history_before as
select (select count(*) from public.daily_reports where user_id = '6a000000-0000-4000-8000-000000000003') as reports,
       (select count(*) from public.time_entries where user_id = '6a000000-0000-4000-8000-000000000003') as time_entries,
       (select count(*) from public.task_assignees where user_id = '6a000000-0000-4000-8000-000000000003') as assignments,
       (select count(*) from public.task_comments where user_id = '6a000000-0000-4000-8000-000000000003') as comments,
       (select count(*) from public.activity_logs where user_id = '6a000000-0000-4000-8000-000000000003') as activity,
       (select count(*) from public.bug_reports where reported_by = '6a000000-0000-4000-8000-000000000003') as bugs;
select ok((select reports = 1 and time_entries = 1 and assignments = 1 and comments = 1 and activity > 0 and bugs = 1 from history_before),
  'emp has reports, time, an assignment, a comment, activity and a bug report');

-- A view of the same counts, compared with the snapshot after each step.
create temporary view history_now as
select (select count(*) from public.daily_reports where user_id = '6a000000-0000-4000-8000-000000000003') as reports,
       (select count(*) from public.time_entries where user_id = '6a000000-0000-4000-8000-000000000003') as time_entries,
       (select count(*) from public.task_assignees where user_id = '6a000000-0000-4000-8000-000000000003') as assignments,
       (select count(*) from public.task_comments where user_id = '6a000000-0000-4000-8000-000000000003') as comments,
       (select count(*) from public.activity_logs where user_id = '6a000000-0000-4000-8000-000000000003') as activity,
       (select count(*) from public.bug_reports where reported_by = '6a000000-0000-4000-8000-000000000003') as bugs;

-- ---------------------------------------------------------------------------
-- Deactivation keeps everything, and authorized people can still read it
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ update public.profiles set is_active = false where id = '6a000000-0000-4000-8000-000000000003' $$,
  'the super admin deactivates emp');
reset role;
set local request.jwt.claims to '';
select ok((select row(b.*) = row(n.*) from history_before b, history_now n), 'deactivation keeps every historical record');

set local role authenticated;
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports where user_id = '6a000000-0000-4000-8000-000000000003'), 1,
  'the super admin still reads emp''s report');
select is((select count(*)::int from public.task_comments where user_id = '6a000000-0000-4000-8000-000000000003'), 1,
  'the super admin still reads emp''s comment');
select ok((select count(*) > 0 from public.activity_logs where user_id = '6a000000-0000-4000-8000-000000000003'),
  'the super admin still reads emp''s activity');
select is((select status::text from public.tasks where id = '6c000000-0000-4000-8000-000000000001'), 'COMPLETED',
  'emp''s completed task is still there');
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports where user_id = '6a000000-0000-4000-8000-000000000003'), 1,
  'the workspace admin still reads emp''s report');
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 0, 'deactivated emp reads nothing');

-- ---------------------------------------------------------------------------
-- Reactivation
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ update public.profiles set is_active = true where id = '6a000000-0000-4000-8000-000000000003' $$,
  'the super admin reactivates emp');
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.tasks where id = '6c000000-0000-4000-8000-000000000001'), 1,
  'reactivated emp sees their task again');
select is((select count(*)::int from public.daily_reports), 1, 'reactivated emp sees their own report again');

-- ---------------------------------------------------------------------------
-- Signed-in users cannot delete accounts or profiles at all
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ delete from public.profiles where id = '6a000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'a super admin cannot delete a profile through the API');
select throws_ok($$ delete from auth.users where id = '6a000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'a super admin cannot delete an auth account through the API');
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ delete from public.profiles where id = '6a000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'an admin cannot delete a profile');
set local request.jwt.claims to '{"sub":"6a000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ delete from public.profiles where id = '6a000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'an employee cannot delete their own profile');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Account deletion with full privileges (Supabase dashboard / auth admin API)
-- ---------------------------------------------------------------------------
select throws_ok($$ delete from auth.users where id = '6a000000-0000-4000-8000-000000000003' $$,
  '55000', 'This employee has work history (tasks, reports, comments or activity) and cannot be deleted. Deactivate them instead.',
  'deleting the auth account of an employee with history is refused');
select throws_ok($$ delete from public.profiles where id = '6a000000-0000-4000-8000-000000000003' $$,
  '55000', null, 'deleting their profile directly is refused too');
select ok((select row(b.*) = row(n.*) from history_before b, history_now n)
          and exists (select 1 from auth.users where id = '6a000000-0000-4000-8000-000000000003'),
  'the refused deletion changed nothing: account, profile and history are intact');

select lives_ok($$ delete from auth.users where id = '6a000000-0000-4000-8000-000000000004' $$,
  'an account with no history (mistaken invite) can still be deleted');
select is((select count(*)::int from public.profiles where id = '6a000000-0000-4000-8000-000000000004'), 0, 'its profile is gone');
select is((select count(*)::int from public.workspace_members where user_id = '6a000000-0000-4000-8000-000000000004'), 0,
  'its membership is gone');

-- Exceptional erasure must be explicit, and then removes the cascaded records.
set local app.allow_history_deletion = 'on';
select lives_ok($$ delete from auth.users where id = '6a000000-0000-4000-8000-000000000003' $$,
  'with the explicit override the account can be erased');
set local app.allow_history_deletion = 'off';
select ok((select reports = 0 and time_entries = 0 and assignments = 0 and bugs = 0 from history_now),
  'explicit erasure removes reports, time, assignments and bug reports (documented)');
select is((select count(*)::int from public.task_comments where task_id = '6c000000-0000-4000-8000-000000000001' and user_id is null), 1,
  'explicit erasure keeps comments, now without an author (documented)');
select is((select status::text from public.tasks where id = '6c000000-0000-4000-8000-000000000001'), 'COMPLETED',
  'the task itself is kept');

select * from finish();
rollback;
