-- Employee lifecycle: deactivating an employee keeps every record of their
-- work, takes away all access to protected data and actions, and is reversible;
-- only super admins can do it, and individuals cannot create employees or
-- raise their own role. (The Auth sign-in block is applied by the server
-- action with the service role; this file covers what the database enforces.)
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). W: sa (super admin), adm (admin), emp and peer (individuals).
-- emp has an assigned task with a comment, a morning plan, an attendance session.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a7000000-0000-4000-8000-000000000001', 'sa@lc.test', '{"full_name":"SA"}'),
  ('a7000000-0000-4000-8000-000000000002', 'adm@lc.test', '{"full_name":"ADM"}'),
  ('a7000000-0000-4000-8000-000000000003', 'emp@lc.test', '{"full_name":"EMP"}'),
  ('a7000000-0000-4000-8000-000000000004', 'peer@lc.test', '{"full_name":"PEER"}'),
  ('a7000000-0000-4000-8000-000000000005', 'new@lc.test', '{"full_name":"NEW"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'a7000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id = 'a7000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by, timezone) values
  ('b7000000-0000-4000-8000-000000000001', 'LC', 'a7000000-0000-4000-8000-000000000001', 'Asia/Kolkata');
insert into public.workspace_members (workspace_id, user_id) values
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001'),
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002'),
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003'),
  ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004')
on conflict do nothing;
insert into public.tasks (id, project_id, title, status) values
  ('c7000000-0000-4000-8000-000000000001', (select id from public.projects where workspace_id = 'b7000000-0000-4000-8000-000000000001' and is_default), 'EMP task', 'IN_PROGRESS');
insert into public.task_assignees (task_id, user_id) values ('c7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003');
insert into public.notifications (user_id, type, title) values ('a7000000-0000-4000-8000-000000000003', 'SYSTEM', 'Welcome');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into public.task_comments (task_id, user_id, comment) values ('c7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003', 'progress');
select public.submit_morning_plan('b7000000-0000-4000-8000-000000000001', 'EMP plan');
select public.attendance_check_in('b7000000-0000-4000-8000-000000000001');
select public.attendance_check_out();
select is((select count(*)::int from public.tasks where id = 'c7000000-0000-4000-8000-000000000001'), 1, 'an active employee sees their assigned task');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Only a super admin can deactivate; admins and individuals cannot
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000002","role":"authenticated"}';
update public.profiles set is_active = false where id = 'a7000000-0000-4000-8000-000000000003';
reset role;
set local request.jwt.claims to '';
select ok((select is_active from public.profiles where id = 'a7000000-0000-4000-8000-000000000003'), 'an admin cannot deactivate an employee');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000004","role":"authenticated"}';
update public.profiles set is_active = false where id = 'a7000000-0000-4000-8000-000000000003';
reset role;
set local request.jwt.claims to '';
select ok((select is_active from public.profiles where id = 'a7000000-0000-4000-8000-000000000003'), 'nor can another individual: the employee is still active');

-- Individuals cannot create employees or raise their own role
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ insert into public.workspace_members (workspace_id, user_id) values ('b7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000005') $$,
  '42501', null, 'an individual cannot add an employee to a workspace');
select throws_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = 'a7000000-0000-4000-8000-000000000004' $$,
  null, null, 'an individual cannot make themselves a super admin');
select throws_ok($$ update public.profiles set role = 'ADMIN' where id = 'a7000000-0000-4000-8000-000000000004' $$,
  null, null, 'nor an admin');
reset role;
set local request.jwt.claims to '';
select is((select role::text from public.profiles where id = 'a7000000-0000-4000-8000-000000000004'), 'INDIVIDUAL', 'the individual is still an individual');

-- ---------------------------------------------------------------------------
-- The super admin deactivates emp with their own (RLS-scoped) client
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000001","role":"authenticated"}';
with u as (update public.profiles set is_active = false where id = 'a7000000-0000-4000-8000-000000000003' returning id)
select is((select count(*)::int from u), 1, 'a super admin deactivates the employee');
select throws_ok($$ delete from public.profiles where id = 'a7000000-0000-4000-8000-000000000003' $$,
  null, null, 'an employee with work history cannot be deleted, even by a super admin');
reset role;
set local request.jwt.claims to '';

-- Nothing of their work is lost
select is((select count(*)::int from public.task_assignees where user_id = 'a7000000-0000-4000-8000-000000000003'), 1, 'the task assignment is kept');
select is((select count(*)::int from public.task_comments where user_id = 'a7000000-0000-4000-8000-000000000003'), 1, 'their comment is kept');
select is((select count(*)::int from public.daily_reports where user_id = 'a7000000-0000-4000-8000-000000000003'), 1, 'their report is kept');
select is((select count(*)::int from public.attendance_sessions where user_id = 'a7000000-0000-4000-8000-000000000003'), 1, 'their attendance is kept');
select is((select count(*)::int from public.attendance_audit_log where target_user_id = 'a7000000-0000-4000-8000-000000000003'), 2, 'the attendance audit trail is kept');
select is((select count(*)::int from public.workspace_members where user_id = 'a7000000-0000-4000-8000-000000000003'), 1, 'the membership is kept');
select ok((select count(*) > 0 from public.activity_logs where user_id = 'a7000000-0000-4000-8000-000000000003' or target_user_id = 'a7000000-0000-4000-8000-000000000003'),
  'the activity history is kept');

-- The deactivated employee (even with a still-valid session token) has no access
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 0, 'a deactivated employee sees no tasks');
select is((select count(*)::int from public.projects), 0, 'no projects');
select is((select count(*)::int from public.workspaces), 0, 'no workspaces');
select is((select count(*)::int from public.daily_reports), 0, 'not even their own reports (032)');
select is((select count(*)::int from public.attendance_sessions), 0, 'nor their own attendance (032)');
select is((select count(*)::int from public.attendance_audit_log), 0, 'nor its audit trail (032)');
select is((select count(*)::int from public.notifications), 0, 'nor their notifications (032)');
select is((select count(*)::int from public.bug_reports), 0, 'nor their bug reports (032)');
select is((select count(*)::int from public.time_entries), 0, 'nor their time entries (032)');
select is((select count(*)::int from public.workspace_members), 0, 'no memberships');
select is((select count(*)::int from public.profiles), 1, 'only their own profile, so sign-in can say the account is deactivated');
select throws_ok($$ select public.attendance_check_in('b7000000-0000-4000-8000-000000000001') $$, '42501', null, 'cannot check in');
select throws_ok($$ insert into public.task_comments (task_id, user_id, comment) values ('c7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003', 'after') $$,
  null, null, 'cannot comment');
update public.tasks set status = 'COMPLETED' where id = 'c7000000-0000-4000-8000-000000000001';
delete from public.notifications where user_id = 'a7000000-0000-4000-8000-000000000003';
select throws_ok($$ select public.submit_evening_report('b7000000-0000-4000-8000-000000000001', 1) $$, null, null, 'cannot submit a report');
reset role;
set local request.jwt.claims to '';
select is((select status::text from public.tasks where id = 'c7000000-0000-4000-8000-000000000001'), 'IN_PROGRESS', 'and cannot update their task');
select ok((select count(*) > 0 from public.notifications where user_id = 'a7000000-0000-4000-8000-000000000003'), 'nor delete their notifications (032)');

-- Their past work stays visible to those who oversee it
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.task_assignees where user_id = 'a7000000-0000-4000-8000-000000000003'), 1, 'the super admin still sees the deactivated employee''s assignment');
select is((select count(*)::int from public.daily_reports where user_id = 'a7000000-0000-4000-8000-000000000003'), 1, 'and their report');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Reactivation restores access
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.profiles set is_active = true where id = 'a7000000-0000-4000-8000-000000000003';
set local request.jwt.claims to '{"sub":"a7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.tasks where id = 'c7000000-0000-4000-8000-000000000001'), 1, 'after reactivation the employee sees their task again');
select is((select count(*)::int from public.daily_reports where user_id = 'a7000000-0000-4000-8000-000000000003'), 1, 'and their own report');
reset role;
set local request.jwt.claims to '';

select * from finish();
rollback;
