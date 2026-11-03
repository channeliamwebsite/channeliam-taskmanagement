-- Migrations 025 and 026: super admins are company-level for TaskManagement. They read
-- and manage records in every workspace without being a member; ADMIN and
-- INDIVIDUAL stay limited to their workspaces; deactivated super admins get
-- nothing; restricted HR data and operations are not reachable; company-wide
-- changes are audited with the super admin as actor.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
--   sa  = super admin, member of no workspace     off = deactivated super admin
--   ad1 = admin of W1 (may create projects)       iv1 = individual in W1
--   ad2 = admin of W2                             iv2 = individual in W2
--   nm  = employee in no workspace (added to W2 by sa below)
--   lone = employee who stays in no workspace (company-level audit, 026)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c9000000-0000-4000-8000-000000000001', 'sa@ca.test', '{"full_name":"SA"}'),
  ('c9000000-0000-4000-8000-000000000002', 'off@ca.test', '{"full_name":"OFF"}'),
  ('c9000000-0000-4000-8000-000000000003', 'ad1@ca.test', '{"full_name":"AD1"}'),
  ('c9000000-0000-4000-8000-000000000004', 'iv1@ca.test', '{"full_name":"IV1"}'),
  ('c9000000-0000-4000-8000-000000000005', 'ad2@ca.test', '{"full_name":"AD2"}'),
  ('c9000000-0000-4000-8000-000000000006', 'iv2@ca.test', '{"full_name":"IV2"}'),
  ('c9000000-0000-4000-8000-000000000007', 'nm@ca.test', '{"full_name":"NM"}'),
  ('c9000000-0000-4000-8000-000000000008', 'lone@ca.test', '{"full_name":"LONE"}');
update public.profiles set role = 'SUPER_ADMIN'
  where id in ('c9000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002');
update public.profiles set is_active = false where id = 'c9000000-0000-4000-8000-000000000002';
update public.profiles set role = 'ADMIN'
  where id in ('c9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000005');

insert into public.workspaces (id, name, created_by) values
  ('ca000000-0000-4000-8000-000000000001', 'CA One', 'c9000000-0000-4000-8000-000000000001'),
  ('ca000000-0000-4000-8000-000000000002', 'CA Two', 'c9000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id, can_create_projects) values
  ('ca000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000003', true),
  ('ca000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000004', false),
  ('ca000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000005', true),
  ('ca000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000006', false);

insert into public.clients (id, workspace_id, name) values
  ('cb000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'Client One'),
  ('cb000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002', 'Client Two');
insert into public.projects (id, workspace_id, name, client_id) values
  ('cc000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000001', 'Site One', 'cb000000-0000-4000-8000-000000000001'),
  ('cc000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002', 'Site Two', 'cb000000-0000-4000-8000-000000000002');
insert into public.tasks (id, project_id, title) values
  ('cd000000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'W1 task'),
  ('cd000000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000002', 'W2 task');
insert into public.task_assignees (task_id, user_id, is_primary) values
  ('cd000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000004', true),
  ('cd000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000006', true);
insert into public.task_comments (task_id, user_id, comment) values
  ('cd000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000006', 'W2 comment');
insert into public.daily_reports (user_id, workspace_id, report_date, accomplishments, evening_submitted_at) values
  ('c9000000-0000-4000-8000-000000000004', 'ca000000-0000-4000-8000-000000000001', '2026-10-20', 'W1 work', '2026-10-20 18:00+05:30'),
  ('c9000000-0000-4000-8000-000000000006', 'ca000000-0000-4000-8000-000000000002', '2026-10-20', 'W2 work', '2026-10-20 18:00+05:30');
insert into public.meeting_links (id, workspace_id, title, url) values
  ('ce000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000002', 'W2 stand-up', 'https://meet.example.com/w2');
insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date, notes) values
  ('ca000000-0000-4000-8000-000000000002', 'ce000000-0000-4000-8000-000000000002', '2026-10-20', 'W2 notes');
insert into public.bug_reports (workspace_id, reported_by, title, description) values
  ('ca000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000006', 'W2 bug', 'Broken');

select is((select count(*)::int from public.workspace_members where user_id = 'c9000000-0000-4000-8000-000000000001'), 0,
  'a super admin who creates workspaces is not made a member of them');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Super admin, member of no workspace: company-wide read
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c9000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(private.is_company_admin(), 'an active super admin is a company admin');
select is((select count(*)::int from public.workspaces where id in ('ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002')), 2,
  'reads every workspace');
select is((select count(*)::int from public.workspace_members where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 2,
  'reads the members of a workspace they are not in');
select ok(exists (select 1 from public.profiles where id = 'c9000000-0000-4000-8000-000000000006'), 'reads employee profiles in any workspace');
select is((select count(*)::int from public.clients where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 1, 'reads clients in any workspace');
select is((select count(*)::int from public.projects where workspace_id = 'ca000000-0000-4000-8000-000000000002' and not is_default), 1,
  'reads projects in any workspace');
select is((select count(*)::int from public.tasks where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 1, 'reads tasks in any workspace');
select is((select count(*)::int from public.task_assignees where task_id = 'cd000000-0000-4000-8000-000000000002'), 1, 'reads assignments in any workspace');
select is((select count(*)::int from public.task_comments where task_id = 'cd000000-0000-4000-8000-000000000002'), 1, 'reads comments in any workspace');
select is((select count(*)::int from public.daily_reports where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 1,
  'reads morning plans and evening reports in any workspace');
select is((select count(*)::int from public.meeting_links where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 1, 'reads meetings in any workspace');
select is((select count(*)::int from public.meeting_records where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 1, 'reads meeting records in any workspace');
select is((select count(*)::int from public.bug_reports where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 1, 'reads bug reports in any workspace');
select ok(exists (select 1 from public.activity_logs where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 'reads activity in any workspace');
select lives_ok($$ select count(*) from public.daily_tracking('ca000000-0000-4000-8000-000000000002') $$,
  'opens the daily tracking of a workspace they are not in');

-- ---------------------------------------------------------------------------
-- Super admin: company-wide management in an explicitly chosen workspace
-- ---------------------------------------------------------------------------
select lives_ok($$
  insert into public.clients (id, workspace_id, name, created_by)
  values ('cb000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000001', 'New client', 'c9000000-0000-4000-8000-000000000001')
$$, 'creates a client in a chosen workspace');
select lives_ok($$
  insert into public.projects (id, workspace_id, name, client_id, created_by)
  values ('cc000000-0000-4000-8000-000000000011', 'ca000000-0000-4000-8000-000000000001', 'New project',
          'cb000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001')
$$, 'creates a project for that client');
select throws_ok($$
  insert into public.projects (workspace_id, name, client_id, created_by)
  values ('ca000000-0000-4000-8000-000000000002', 'Wrong client', 'cb000000-0000-4000-8000-000000000011', 'c9000000-0000-4000-8000-000000000001')
$$, '23514', null, 'a project cannot use a client from another workspace');
select lives_ok($$
  select public.create_task('cc000000-0000-4000-8000-000000000002', 'SA assigns in W2',
    array['c9000000-0000-4000-8000-000000000006']::uuid[])
$$, 'creates and assigns a task in a workspace they are not in');
select is((select workspace_id::text from public.tasks where title = 'SA assigns in W2'), 'ca000000-0000-4000-8000-000000000002',
  'the task belongs to its project''s workspace');
select lives_ok($$
  insert into public.tasks (project_id, workspace_id, title)
  values ('cc000000-0000-4000-8000-000000000002', 'ca000000-0000-4000-8000-000000000001', 'Mismatched workspace')
$$, 'a direct insert with another workspace id is accepted ...');
select is((select workspace_id::text from public.tasks where title = 'Mismatched workspace'), 'ca000000-0000-4000-8000-000000000002',
  '... but the task is stored in its project''s workspace');
select lives_ok($$
  select public.set_task_assignees('cd000000-0000-4000-8000-000000000002',
    array['c9000000-0000-4000-8000-000000000005']::uuid[], 'c9000000-0000-4000-8000-000000000005')
$$, 'reassigns a task in a workspace they are not in');
select lives_ok($$
  insert into public.task_comments (task_id, user_id, comment)
  values ('cd000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000001', 'From the super admin')
$$, 'comments on any task');
update public.workspaces set timezone = 'UTC' where id = 'ca000000-0000-4000-8000-000000000002';
select lives_ok($$
  insert into public.workspace_members (workspace_id, user_id) values ('ca000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000007')
$$, 'adds an employee to a workspace they are not in');
update public.profiles set role = 'ADMIN' where id = 'c9000000-0000-4000-8000-000000000006';
update public.profiles set job_title = 'Reviewer' where id = 'c9000000-0000-4000-8000-000000000008';
select lives_ok($$
  insert into public.meeting_links (workspace_id, title, url, created_by)
  values ('ca000000-0000-4000-8000-000000000001', 'W1 review', 'https://meet.example.com/w1', 'c9000000-0000-4000-8000-000000000001')
$$, 'schedules a meeting in a workspace they are not in');
select lives_ok($$
  insert into public.bug_reports (workspace_id, reported_by, title, description)
  values ('ca000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'SA bug', 'Seen in W1')
$$, 'files a bug report in any workspace');
select is((select count(*)::int from public.workspace_members where user_id = 'c9000000-0000-4000-8000-000000000001'), 0,
  'none of this makes the super admin a member');

-- Super admin: what stays refused
select throws_ok($$ select public.submit_morning_plan('ca000000-0000-4000-8000-000000000002', 'Plan') $$,
  '42501', null, 'still cannot submit a daily report');
select throws_ok($$ select public.attendance_check_in('ca000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'still cannot check in where they are not a member (024 unchanged)');
select throws_ok($$
  insert into public.attendance_sessions (workspace_id, user_id, work_date)
  values ('ca000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000006', '2026-10-20')
$$, '42501', null, 'cannot write attendance records (no HR write path)');
select throws_ok($$
  select private.log_attendance('ca000000-0000-4000-8000-000000000002', 'CHECK_IN', 'session', null, null, '{}'::jsonb)
$$, '42501', null, 'cannot write the attendance audit log');
delete from public.workspaces where id = 'ca000000-0000-4000-8000-000000000002';
select throws_ok($$ update public.profiles set role = 'ADMIN' where id = 'c9000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'cannot change their own role');
select throws_ok($$
  insert into public.task_assignees (task_id, user_id) values ('cd000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001')
$$, '23514', null, 'cannot be assigned work in a workspace they are not a member of');
select throws_ok($$
  insert into public.activity_logs (workspace_id, user_id, action) values ('ca000000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'CLIENT_CREATED')
$$, '42501', null, 'cannot forge audit entries');
select throws_ok($$ update public.activity_logs set action = 'CLIENT_DELETED' where workspace_id = 'ca000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'cannot edit audit entries');
select throws_ok($$ delete from public.activity_logs where workspace_id = 'ca000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'cannot delete audit entries');

reset role;
set local request.jwt.claims to '';
select is((select timezone from public.workspaces where id = 'ca000000-0000-4000-8000-000000000002'), 'UTC',
  'changes workspace settings without membership');
select is((select role::text from public.profiles where id = 'c9000000-0000-4000-8000-000000000006'), 'ADMIN',
  'changes an employee''s TaskManagement role');
select is((select count(*)::int from public.workspaces where id = 'ca000000-0000-4000-8000-000000000002'), 1,
  'cannot delete a workspace (023 unchanged)');
select is((select count(*)::int from public.task_assignees where task_id = 'cd000000-0000-4000-8000-000000000002' and user_id = 'c9000000-0000-4000-8000-000000000005' and is_primary), 1,
  'the reassignment took effect');

-- Audit: the super admin is the recorded actor, in the target workspace
select is((select count(*)::int from public.activity_logs
           where user_id = 'c9000000-0000-4000-8000-000000000001' and action = 'CLIENT_CREATED' and workspace_id = 'ca000000-0000-4000-8000-000000000001'), 1,
  'creating a client is audited with the super admin as actor');
select is((select count(*)::int from public.activity_logs
           where user_id = 'c9000000-0000-4000-8000-000000000001' and action = 'TASK_CREATED' and workspace_id = 'ca000000-0000-4000-8000-000000000002'), 2,
  'creating tasks is audited in the task''s workspace');
select is((select count(*)::int from public.activity_logs
           where user_id = 'c9000000-0000-4000-8000-000000000001' and action = 'MEMBER_ADDED' and workspace_id = 'ca000000-0000-4000-8000-000000000002'), 1,
  'adding a member is audited');
select is((select count(*)::int from public.activity_logs
           where user_id = 'c9000000-0000-4000-8000-000000000001' and action = 'EMPLOYEE_ROLE_CHANGED' and target_user_id = 'c9000000-0000-4000-8000-000000000006'), 1,
  'a role change is audited');

-- 026: company-level events
select is((select count(*)::int from public.activity_logs
           where action = 'WORKSPACE_CREATED' and workspace_id in ('ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002')), 2,
  'creating a workspace is audited (026)');
select is((select format('%s|%s', old_value ->> 'timezone', new_value ->> 'timezone') from public.activity_logs
           where action = 'WORKSPACE_UPDATED' and workspace_id = 'ca000000-0000-4000-8000-000000000002'
             and user_id = 'c9000000-0000-4000-8000-000000000001'),
  'Asia/Kolkata|UTC', 'a workspace setting change is audited with the super admin as actor (026)');
select is((select count(*)::int from public.activity_logs
           where action = 'EMPLOYEE_UPDATED' and target_user_id = 'c9000000-0000-4000-8000-000000000008'
             and workspace_id is null and user_id = 'c9000000-0000-4000-8000-000000000001'), 1,
  'a change to an employee in no workspace is audited once, without a workspace (026)');

-- ---------------------------------------------------------------------------
-- Restricted HR boundary (structure)
-- ---------------------------------------------------------------------------
-- Identity data (PAN ciphertext, last fours) exists only in hr_employee_identity
-- (035, decided 2026-11-03); salary, payroll, emergency contacts and bank
-- details are still not stored anywhere.
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and column_name ~* '(pan_|aadhaar)' and table_name <> 'hr_employee_identity'), 0,
  'identity fields exist only in hr_employee_identity');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and column_name ~* '(salary|payroll|emergency|bank_account)'), 0,
  'no salary, payroll, emergency-contact or bank fields exist');
-- HR tables are named attendance_* or hr_* (033 onwards), so this boundary
-- stays checkable as the HR module grows.
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and (tablename like 'attendance%' or tablename like 'hr\_%')
             and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_company_admin'), 0,
  'HR (attendance_*, hr_*) policies do not use the TaskManagement company-admin helper');
select is((select count(*)::int from pg_policies
           where schemaname = 'public' and tablename not like 'attendance%' and tablename not like 'hr\_%'
             and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'is_super_admin\('), 0,
  'TaskManagement policies do not use the HR helper');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Deactivated super admin: nothing
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c9000000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(not private.is_company_admin(), 'a deactivated super admin is not a company admin');
select is((select count(*)::int from public.tasks where workspace_id in ('ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002')), 0,
  'a deactivated super admin reads no tasks');
select is((select count(*)::int from public.daily_reports where workspace_id in ('ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002')), 0,
  'a deactivated super admin reads no reports');
select is((select count(*)::int from public.workspaces where id in ('ca000000-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-000000000002')), 0,
  'a deactivated super admin sees no workspaces');
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by) values ('ca000000-0000-4000-8000-000000000001', 'Off client', 'c9000000-0000-4000-8000-000000000002')
$$, '42501', null, 'a deactivated super admin cannot create clients');
select throws_ok($$
  select public.create_task('cc000000-0000-4000-8000-000000000001', 'Off task', array['c9000000-0000-4000-8000-000000000004']::uuid[])
$$, '42501', null, 'a deactivated super admin cannot create tasks');

-- ---------------------------------------------------------------------------
-- Admin of W1: limited to W1
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c9000000-0000-4000-8000-000000000003","role":"authenticated"}';
select ok(not private.is_company_admin(), 'an admin is not a company admin');
select is((select count(*)::int from public.workspaces where id = 'ca000000-0000-4000-8000-000000000002'), 0, 'an admin cannot see another workspace');
select is((select format('%s|%s|%s|%s|%s|%s',
    (select count(*) from public.workspace_members where workspace_id = 'ca000000-0000-4000-8000-000000000002'),
    (select count(*) from public.clients where workspace_id = 'ca000000-0000-4000-8000-000000000002'),
    (select count(*) from public.projects where workspace_id = 'ca000000-0000-4000-8000-000000000002'),
    (select count(*) from public.tasks where workspace_id = 'ca000000-0000-4000-8000-000000000002'),
    (select count(*) from public.daily_reports where workspace_id = 'ca000000-0000-4000-8000-000000000002'),
    (select count(*) from public.meeting_links where workspace_id = 'ca000000-0000-4000-8000-000000000002'))),
  '0|0|0|0|0|0', 'an admin reads nothing of another workspace (members, clients, projects, tasks, reports, meetings)');
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by) values ('ca000000-0000-4000-8000-000000000002', 'Foreign', 'c9000000-0000-4000-8000-000000000003')
$$, '42501', null, 'an admin cannot create clients in another workspace');
select throws_ok($$
  insert into public.projects (workspace_id, name, created_by) values ('ca000000-0000-4000-8000-000000000002', 'Foreign', 'c9000000-0000-4000-8000-000000000003')
$$, '42501', null, 'an admin cannot create projects in another workspace');
select throws_ok($$
  select public.create_task('cc000000-0000-4000-8000-000000000002', 'Foreign task', array['c9000000-0000-4000-8000-000000000003']::uuid[])
$$, '42501', null, 'an admin cannot create tasks in another workspace');
select throws_ok($$ select public.daily_tracking('ca000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'an admin cannot open another workspace''s daily tracking');
update public.workspaces set timezone = 'Asia/Dubai' where id = 'ca000000-0000-4000-8000-000000000002';
select throws_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = 'c9000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'an admin cannot elevate their own role');
select is((select count(*)::int from public.activity_logs where workspace_id is null), 0,
  'an admin cannot read company-level audit entries');
select lives_ok($$
  select public.create_task('cc000000-0000-4000-8000-000000000001', 'W1 admin task', array['c9000000-0000-4000-8000-000000000004']::uuid[])
$$, 'an admin still creates and assigns tasks in their own workspace');

-- ---------------------------------------------------------------------------
-- Individual of W1: no company-wide data, no self-elevation
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c9000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok(not private.is_company_admin(), 'an individual is not a company admin');
select is((select count(*)::int from public.tasks where workspace_id = 'ca000000-0000-4000-8000-000000000002'), 0, 'an individual reads no tasks of another workspace');
select is((select count(*)::int from public.daily_reports where user_id <> 'c9000000-0000-4000-8000-000000000004'), 0,
  'an individual reads no one else''s reports');
select is((select count(*)::int from public.activity_logs where workspace_id is null), 0,
  'an individual cannot read company-level audit entries');
select throws_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = 'c9000000-0000-4000-8000-000000000004' $$,
  '42501', null, 'an individual cannot elevate their own role');
select throws_ok($$
  insert into public.workspace_members (workspace_id, user_id) values ('ca000000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000004')
$$, '42501', null, 'an individual cannot add themselves to another workspace');
update public.workspace_members set can_create_projects = true
  where workspace_id = 'ca000000-0000-4000-8000-000000000001' and user_id = 'c9000000-0000-4000-8000-000000000004';

reset role;
set local request.jwt.claims to '';
select is((select timezone from public.workspaces where id = 'ca000000-0000-4000-8000-000000000002'), 'UTC',
  'the admin''s change to another workspace had no effect');
select ok(not (select can_create_projects from public.workspace_members
               where workspace_id = 'ca000000-0000-4000-8000-000000000001' and user_id = 'c9000000-0000-4000-8000-000000000004'),
  'an individual cannot grant themselves project creation');

select * from finish();
rollback;
