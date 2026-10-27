-- Employee management: what the Employees page does through the super admin's
-- own (RLS-scoped) client, what other roles cannot do, and how membership,
-- active status and role changes interact with daily reporting.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). W (Asia/Kolkata): sa (creator), adm, e1.
-- e2 = a newly invited employee (account exists, no membership yet).
-- W2: s2, a super admin of another workspace only.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8c000000-0000-4000-8000-000000000001', 'sa@ea.test', '{"full_name":"SA"}'),
  ('8c000000-0000-4000-8000-000000000002', 'adm@ea.test', '{"full_name":"ADM"}'),
  ('8c000000-0000-4000-8000-000000000003', 'e1@ea.test', '{"full_name":"E1"}'),
  ('8c000000-0000-4000-8000-000000000004', 'e2@ea.test', '{"full_name":"Invited E2"}'),
  ('8c000000-0000-4000-8000-000000000005', 's2@ea.test', '{"full_name":"S2"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('8c000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000005');
update public.profiles set role = 'ADMIN' where id = '8c000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by, timezone) values
  ('9d000000-0000-4000-8000-000000000001', 'EA', '8c000000-0000-4000-8000-000000000001', 'Asia/Kolkata'),
  ('9d000000-0000-4000-8000-000000000002', 'EA other', '8c000000-0000-4000-8000-000000000005', 'Asia/Kolkata');
insert into public.workspace_members (workspace_id, user_id) values
  ('9d000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000002'),
  ('9d000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000003');
insert into public.tasks (id, project_id, title, status) values
  ('7e000000-0000-4000-8000-000000000001', (select id from public.projects where workspace_id = '9d000000-0000-4000-8000-000000000001' and is_default), 'E2 first task', 'TODO'),
  ('7e000000-0000-4000-8000-000000000002', (select id from public.projects where workspace_id = '9d000000-0000-4000-8000-000000000001' and is_default), 'Later task', 'TODO');
insert into public.task_assignees (task_id, user_id) values ('7e000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000003');
select ok((select full_name = 'Invited E2' and role = 'INDIVIDUAL' and is_active from public.profiles where id = '8c000000-0000-4000-8000-000000000004'),
  'an invited account gets an active Individual profile with the invited name');
-- e1 has a report for today (for the report-visibility checks below).
set local role authenticated;
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.submit_morning_plan('9d000000-0000-4000-8000-000000000001', 'E1 notes');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Unauthorized attempts
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ insert into public.workspace_members (workspace_id, user_id) values ('9d000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'an admin cannot add employees to the workspace');
update public.profiles set role = 'ADMIN', team = 'Hacked' where id = '8c000000-0000-4000-8000-000000000003';
select is((select format('%s|%s', role, coalesce(team, '-')) from public.profiles where id = '8c000000-0000-4000-8000-000000000003'),
  'INDIVIDUAL|-', 'an admin cannot change another employee''s role or department');
select is((select count(*)::int from public.workspace_members where workspace_id = '9d000000-0000-4000-8000-000000000001' and user_id = '8c000000-0000-4000-8000-000000000003'), 1,
  'an admin can see memberships of their workspace');
delete from public.workspace_members where workspace_id = '9d000000-0000-4000-8000-000000000001' and user_id = '8c000000-0000-4000-8000-000000000003';
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = '8c000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'an individual cannot change their own role');
select is((select count(*)::int from public.workspace_members where workspace_id = '9d000000-0000-4000-8000-000000000001' and user_id = '8c000000-0000-4000-8000-000000000003'), 1,
  'an admin cannot remove employees from the workspace');
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ insert into public.workspace_members (workspace_id, user_id) values ('9d000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'a super admin of another workspace cannot add employees here');
update public.profiles set is_active = false where id = '8c000000-0000-4000-8000-000000000003';
reset role;
set local request.jwt.claims to '';
select ok((select is_active from public.profiles where id = '8c000000-0000-4000-8000-000000000003'),
  'a super admin of another workspace cannot deactivate employees here');

-- ---------------------------------------------------------------------------
-- Add employee (what createEmployee does after the Auth invitation)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ insert into public.workspace_members (workspace_id, user_id, can_create_projects) values ('9d000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000004', false) $$,
  'the super admin adds the invited employee to the workspace');
select throws_ok($$ insert into public.workspace_members (workspace_id, user_id) values ('9d000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000004') $$,
  '23505', null, 'a duplicate membership is rejected');
update public.profiles set full_name = 'Employee Two', team = 'Creatives', job_title = 'Designer', role = 'ADMIN',
       manager_id = '8c000000-0000-4000-8000-000000000002'
where id = '8c000000-0000-4000-8000-000000000004';
select is(
  (select format('%s|%s|%s|%s|%s', full_name, team, job_title, role, manager_id) from public.profiles where id = '8c000000-0000-4000-8000-000000000004'),
  'Employee Two|Creatives|Designer|ADMIN|8c000000-0000-4000-8000-000000000002',
  'the super admin sets name, department, designation, role and manager');
select throws_ok($$ update public.profiles set manager_id = '8c000000-0000-4000-8000-000000000004' where id = '8c000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'reporting lines cannot loop');
select throws_ok($$ update public.profiles set is_active = false where id = '8c000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a super admin cannot deactivate themselves');
select lives_ok($$ insert into public.task_assignees (task_id, user_id) values ('7e000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000004') $$,
  'the new employee can be assigned a task');

-- The new employee works normally: sees the workspace, writes a morning plan.
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.tasks where id = '7e000000-0000-4000-8000-000000000001'), 1, 'the new employee sees their task');
select lives_ok($$ select public.submit_morning_plan('9d000000-0000-4000-8000-000000000001', 'First day notes') $$, 'the new employee submits a morning plan');
select is((select count(*)::int from public.daily_reports where user_id = '8c000000-0000-4000-8000-000000000003'), 1,
  'as an Admin, the new employee can read team reports');

-- Role change takes effect immediately in the database.
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.profiles set role = 'INDIVIDUAL' where id = '8c000000-0000-4000-8000-000000000004';
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports where user_id = '8c000000-0000-4000-8000-000000000003'), 0,
  'after the role change to Individual, other employees'' reports are hidden');

-- ---------------------------------------------------------------------------
-- Deactivate: no access, history kept, no morning report, still visible to
-- the super admin's tracking with open work
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.profiles set is_active = false where id = '8c000000-0000-4000-8000-000000000004';
select is((select is_active from public.profiles where id = '8c000000-0000-4000-8000-000000000004'), false,
  'the super admin deactivates the employee');
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 0, 'a deactivated employee reads no tasks');
select is((select count(*)::int from public.workspaces), 0, 'a deactivated employee sees no workspace');
select throws_ok($$ select public.submit_morning_plan('9d000000-0000-4000-8000-000000000001', 'x') $$, '42501', null,
  'a deactivated employee cannot submit reports');
select throws_ok($$ select * from public.daily_tracking('9d000000-0000-4000-8000-000000000001') $$, '42501', null,
  'a deactivated employee cannot read tracking');
reset role;
set local request.jwt.claims to '';
select is(
  (select format('%s|%s|%s',
     (select count(*) from public.task_assignees where user_id = '8c000000-0000-4000-8000-000000000004'),
     (select morning_plan from public.daily_reports where user_id = '8c000000-0000-4000-8000-000000000004'),
     (select count(*) from public.workspace_members where user_id = '8c000000-0000-4000-8000-000000000004'))),
  '1|First day notes|1', 'deactivation keeps assignments, reports and membership');
select throws_ok($$ insert into public.task_assignees (task_id, user_id) values ('7e000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000004') $$,
  null, null, 'a deactivated employee cannot be assigned new work');

select private.generate_morning_reports(now(), true, '9d000000-0000-4000-8000-000000000001');
select is(
  (select string_agg(p.email, ',' order by p.email) from public.daily_reports r join public.profiles p on p.id = r.user_id
   where r.workspace_id = '9d000000-0000-4000-8000-000000000001' and r.morning_snapshot is not null),
  'adm@ea.test,e1@ea.test,sa@ea.test', 'the morning report job skips the deactivated employee');
select ok(
  (select morning_snapshot is null and morning_plan = 'First day notes' from public.daily_reports where user_id = '8c000000-0000-4000-8000-000000000004'),
  'the deactivated employee''s own notes are left untouched');
set local role authenticated;
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select string_agg(title || ':' || tracking, ',') from public.daily_tracking('9d000000-0000-4000-8000-000000000001')
   where user_id = '8c000000-0000-4000-8000-000000000004'),
  'E2 first task:CURRENT', 'the super admin still sees the deactivated employee''s open work (no morning report)');

-- ---------------------------------------------------------------------------
-- Reactivate: access returns through the existing membership
-- ---------------------------------------------------------------------------
update public.profiles set is_active = true where id = '8c000000-0000-4000-8000-000000000004';
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.tasks where id = '7e000000-0000-4000-8000-000000000001'), 1, 'a reactivated employee regains access');
select lives_ok($$ select * from public.daily_tracking('9d000000-0000-4000-8000-000000000001') $$, 'a reactivated employee can read their tracking');
reset role;
set local request.jwt.claims to '';
select is(private.generate_morning_reports(now() + interval '15 minutes', true, '9d000000-0000-4000-8000-000000000001'), 1,
  'the next morning job run includes the reactivated employee (only them; nobody else is duplicated)');

-- ---------------------------------------------------------------------------
-- Workspace access removed: no access to that workspace, history kept
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000001","role":"authenticated"}';
delete from public.workspace_members
where workspace_id = '9d000000-0000-4000-8000-000000000001' and user_id = '8c000000-0000-4000-8000-000000000004';
select is((select count(*)::int from public.workspace_members where user_id = '8c000000-0000-4000-8000-000000000004'), 0,
  'the super admin removes the employee''s workspace access');
select is((select count(*)::int from public.daily_tracking('9d000000-0000-4000-8000-000000000001') where user_id = '8c000000-0000-4000-8000-000000000004'), 0,
  'tracking no longer lists someone outside the workspace');
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 0, 'without workspace access the employee sees no tasks');
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.daily_reports where user_id = '8c000000-0000-4000-8000-000000000004'), 1,
  'their earlier report is kept');

-- ---------------------------------------------------------------------------
-- Adding an EXISTING account to another workspace (createEmployee "Add
-- existing account"): only the membership is inserted; the account's
-- company-wide role and profile are unchanged.
-- ---------------------------------------------------------------------------
update public.profiles set team = 'News Desk', job_title = 'Editor', manager_id = '8c000000-0000-4000-8000-000000000001'
where id = '8c000000-0000-4000-8000-000000000002';
update public.profiles set team = 'Creatives', job_title = 'Head' where id = '8c000000-0000-4000-8000-000000000005';
create temp table before_add as
  select id, role, is_active, full_name, team, job_title, manager_id from public.profiles
  where id in ('8c000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000005');
set local role authenticated;
-- s2 (super admin of W2) adds adm (an Admin of W) to W2.
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000005","role":"authenticated"}';
select lives_ok($$ insert into public.workspace_members (workspace_id, user_id, can_create_projects) values ('9d000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000002', false) $$,
  'a super admin adds an existing Admin from another workspace');
-- sa (super admin of W) adds s2 (a Super Admin of W2) to W.
set local request.jwt.claims to '{"sub":"8c000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ insert into public.workspace_members (workspace_id, user_id, can_create_projects) values ('9d000000-0000-4000-8000-000000000001', '8c000000-0000-4000-8000-000000000005', false) $$,
  'a super admin adds an existing Super Admin from another workspace');
reset role;
set local request.jwt.claims to '';
select is(
  (select count(*)::int from public.profiles p join before_add b using (id)
   where (p.role, p.is_active, p.full_name, p.team, p.job_title, p.manager_id)
         is not distinct from (b.role, b.is_active, b.full_name, b.team, b.job_title, b.manager_id)),
  2, 'the added Admin and Super Admin keep their role, status, name, department, designation and manager');
select is(
  (select string_agg(p.role::text, ',' order by p.role) from public.profiles p where p.id in ('8c000000-0000-4000-8000-000000000002', '8c000000-0000-4000-8000-000000000005')),
  'SUPER_ADMIN,ADMIN', 'roles are unchanged (Super Admin stays Super Admin, Admin stays Admin)');

select * from finish();
rollback;
