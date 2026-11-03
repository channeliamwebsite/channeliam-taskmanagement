-- Audit trail for administrative changes (migration 017).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres, no user): sa and sa2 = super admins, ad = admin,
-- iv = individual, all in workspace W.
insert into auth.users (id, email, raw_user_meta_data) values
  ('7a000000-0000-4000-8000-000000000001', 'sa@audit.test', '{"full_name":"SA"}'),
  ('7a000000-0000-4000-8000-000000000002', 'sa2@audit.test', '{"full_name":"SA2"}'),
  ('7a000000-0000-4000-8000-000000000003', 'ad@audit.test', '{"full_name":"AD"}'),
  ('7a000000-0000-4000-8000-000000000004', 'iv@audit.test', '{"full_name":"IV"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('7a000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000002');
update public.profiles set role = 'ADMIN' where id = '7a000000-0000-4000-8000-000000000003';
insert into public.workspaces (id, name, created_by) values
  ('7b000000-0000-4000-8000-000000000001', 'Audit', '7a000000-0000-4000-8000-000000000001');
-- Since 025 a super admin creator is not auto-added; their membership is explicit.
insert into public.workspace_members (workspace_id, user_id) values
  ('7b000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001'),
  ('7b000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000002'),
  ('7b000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000003'),
  ('7b000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000004');

-- Audit entries of W (read as postgres, so RLS does not hide any).
create temporary view audit as
select * from public.activity_logs where workspace_id = '7b000000-0000-4000-8000-000000000001';

select is((select count(*)::int from audit where action = 'MEMBER_ADDED'), 4, 'adding members is recorded (the super admin''s membership included)');
select ok((select bool_and(user_id is null) from audit where action = 'MEMBER_ADDED'),
  'changes made without a signed-in user are recorded with no actor');

-- ---------------------------------------------------------------------------
-- Employee changes by the super admin
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.profiles set role = 'ADMIN' where id = '7a000000-0000-4000-8000-000000000004';
update public.profiles set team = 'Design', job_title = 'Designer' where id = '7a000000-0000-4000-8000-000000000004';
update public.profiles set is_active = false where id = '7a000000-0000-4000-8000-000000000004';
update public.profiles set is_active = true where id = '7a000000-0000-4000-8000-000000000004';
update public.profiles set role = 'INDIVIDUAL' where id = '7a000000-0000-4000-8000-000000000004';
update public.profiles set full_name = 'Ivy' where id = '7a000000-0000-4000-8000-000000000004';
reset role;
set local request.jwt.claims to '';

select is((select format('%s|%s|%s|%s', user_id, target_user_id, old_value->>'role', new_value->>'role') from audit
           where action = 'EMPLOYEE_ROLE_CHANGED' order by created_at, new_value->>'role' limit 1),
  '7a000000-0000-4000-8000-000000000001|7a000000-0000-4000-8000-000000000004|INDIVIDUAL|ADMIN',
  'a role change records the super admin as actor, the employee as target and old/new role');
select is((select count(*)::int from audit where action = 'EMPLOYEE_ROLE_CHANGED'), 2, 'both role changes are recorded');
select is((select count(*)::int from audit where action = 'EMPLOYEE_DEACTIVATED'
           and user_id = '7a000000-0000-4000-8000-000000000001' and target_user_id = '7a000000-0000-4000-8000-000000000004'), 1,
  'deactivation is recorded with actor and target');
select is((select count(*)::int from audit where action = 'EMPLOYEE_REACTIVATED'), 1, 'reactivation is recorded');
select is((select new_value from audit where action = 'EMPLOYEE_UPDATED'), '{"team": "Design", "job_title": "Designer"}'::jsonb,
  'organisation changes record only the changed fields');
select is((select count(*)::int from audit where target_user_id = '7a000000-0000-4000-8000-000000000004'
           and action = 'EMPLOYEE_UPDATED'), 1, 'a name change alone is not an administrative entry');

-- ---------------------------------------------------------------------------
-- Membership permission, clients, projects, tasks
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.workspace_members set can_create_projects = false
where workspace_id = '7b000000-0000-4000-8000-000000000001' and user_id = '7a000000-0000-4000-8000-000000000003';
insert into public.clients (id, workspace_id, name) values
  ('7c000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000001', 'Acme');
update public.clients set name = 'Acme Ltd', contact_email = 'secret.person@acme.test'
where id = '7c000000-0000-4000-8000-000000000001';
insert into public.projects (id, workspace_id, name, client_id) values
  ('7d000000-0000-4000-8000-000000000001', '7b000000-0000-4000-8000-000000000001', 'Website', '7c000000-0000-4000-8000-000000000001');
update public.projects set name = 'Website v2', description = 'Long private notes'
where id = '7d000000-0000-4000-8000-000000000001';
insert into public.tasks (id, project_id, title) values
  ('7e000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', 'Throwaway'),
  ('7e000000-0000-4000-8000-000000000002', '7d000000-0000-4000-8000-000000000001', 'Kept');
insert into public.task_assignees (task_id, user_id) values
  ('7e000000-0000-4000-8000-000000000002', '7a000000-0000-4000-8000-000000000004');
delete from public.tasks where id = '7e000000-0000-4000-8000-000000000001';
reset role;
set local request.jwt.claims to '';

select is((select format('%s|%s', user_id, new_value->>'can_create_projects') from audit where action = 'MEMBER_PERMISSION_CHANGED'),
  '7a000000-0000-4000-8000-000000000001|false', 'project-creation permission changes are recorded');
select is((select count(*)::int from audit where action = 'CLIENT_CREATED' and new_value->>'name' = 'Acme'), 1, 'client creation is recorded');
select ok((select new_value->>'name' = 'Acme Ltd' and (new_value->>'contact_changed')::boolean from audit where action = 'CLIENT_UPDATED'),
  'client updates record the new name and that contact details changed');
select is((select count(*)::int from audit where audit::text like '%secret.person%'), 0, 'client contact details are never stored in the log');
select ok((select new_value->>'name' = 'Website v2' and (new_value->>'description_changed')::boolean from audit where action = 'PROJECT_UPDATED'),
  'project edits are recorded');
select is((select count(*)::int from audit where audit::text like '%Long private notes%'), 0, 'project descriptions are not copied into the log');
select is((select format('%s|%s|%s', user_id, old_value->>'title', (task_id is null and project_id is null)::text) from audit where action = 'TASK_DELETED'),
  '7a000000-0000-4000-8000-000000000001|Throwaway|true', 'task deletion is recorded with its title, without task/project links');
select is((select count(*)::int from audit where action = 'TASK_CREATED'), 2, 'existing task activity is still recorded');
select is((select count(*)::int from audit where action = 'TASK_ASSIGNED'), 1, 'existing assignment activity is still recorded');

-- Existing feeds keep working for the people who could already see them.
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok((select count(*) > 0 from public.activity_logs where task_id = '7e000000-0000-4000-8000-000000000002'),
  'the assignee still reads their task''s activity');
select is((select count(*)::int from public.activity_logs where action in ('EMPLOYEE_ROLE_CHANGED', 'EMPLOYEE_DEACTIVATED', 'TASK_DELETED')), 0,
  'an individual cannot read administrative entries, even about themselves');
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.activity_logs where action in ('EMPLOYEE_ROLE_CHANGED', 'CLIENT_UPDATED', 'TASK_DELETED')), 0,
  'an admin cannot read administrative entries made by others');
select ok((select count(*) > 0 from public.activity_logs where action = 'PROJECT_UPDATED'),
  'an admin still reads project activity in the project feed');

-- ---------------------------------------------------------------------------
-- Nobody can forge, edit or delete entries through the API
-- ---------------------------------------------------------------------------
select throws_ok($$ insert into public.activity_logs (workspace_id, user_id, action)
                   values ('7b000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000001', 'EMPLOYEE_DEACTIVATED') $$,
  '42501', null, 'an admin cannot forge an entry');
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ insert into public.activity_logs (workspace_id, action) values ('7b000000-0000-4000-8000-000000000001', 'CLIENT_DELETED') $$,
  '42501', null, 'a super admin cannot forge an entry');
select throws_ok($$ update public.activity_logs set user_id = null where workspace_id = '7b000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a super admin cannot edit entries');
select throws_ok($$ delete from public.activity_logs where workspace_id = '7b000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a super admin cannot delete entries');
select throws_ok($$ select private.log_audit('7b000000-0000-4000-8000-000000000001', null, null, 'CLIENT_DELETED') $$,
  '42501', null, 'the logging helper cannot be called directly');

-- ---------------------------------------------------------------------------
-- Refused or rolled-back changes leave no success entry
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims to '';
create temporary table audit_count as select count(*) as n from audit;
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = '7a000000-0000-4000-8000-000000000004' $$,
  '42501', null, 'an individual cannot promote themselves');
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000003","role":"authenticated"}';
update public.profiles set is_active = false where id = '7a000000-0000-4000-8000-000000000004'; -- filtered by RLS
update public.workspace_members set can_create_projects = false
where workspace_id = '7b000000-0000-4000-8000-000000000001' and user_id = '7a000000-0000-4000-8000-000000000004'; -- filtered
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ update public.profiles set role = 'ADMIN', manager_id = '7a000000-0000-4000-8000-000000000004'
                   where id = '7a000000-0000-4000-8000-000000000004' $$,
  '23514', null, 'a change that fails a check is rolled back');
reset role;
set local request.jwt.claims to '';
select is((select count(*) from audit), (select n from audit_count), 'refused and rolled-back changes added no entries');
select is((select role::text from public.profiles where id = '7a000000-0000-4000-8000-000000000004'), 'INDIVIDUAL', 'and changed nothing');

-- ---------------------------------------------------------------------------
-- Deletions and history after deactivation
-- ---------------------------------------------------------------------------
-- Since 027 a project with tasks is archived, not deleted, and a client with
-- projects cannot be deleted (014); the deletions below use an empty client
-- with an empty project.
insert into public.clients (id, workspace_id, name) values
  ('7c000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000001', 'Spare client');
insert into public.projects (id, workspace_id, name, client_id) values
  ('7d000000-0000-4000-8000-000000000002', '7b000000-0000-4000-8000-000000000001', 'Empty site', '7c000000-0000-4000-8000-000000000002');
create temporary table task_deletions_before as select count(*) as n from audit where action = 'TASK_DELETED';
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ delete from public.projects where id = '7d000000-0000-4000-8000-000000000001' $$,
  '55000', null, 'a project with tasks cannot be deleted (027)');
delete from public.projects where id = '7d000000-0000-4000-8000-000000000002';
delete from public.clients where id = '7c000000-0000-4000-8000-000000000002';
delete from public.workspace_members where workspace_id = '7b000000-0000-4000-8000-000000000001' and user_id = '7a000000-0000-4000-8000-000000000003';
update public.profiles set is_active = false where id = '7a000000-0000-4000-8000-000000000004';
reset role;
set local request.jwt.claims to '';
select is((select format('%s|%s', user_id, old_value->>'name') from audit where action = 'PROJECT_DELETED'),
  '7a000000-0000-4000-8000-000000000002|Empty site', 'project deletion is recorded with actor and name');
select is((select count(*) from audit where action = 'TASK_DELETED'), (select n from task_deletions_before),
  'the refused deletion removed and logged no tasks');
select is((select count(*)::int from audit where action = 'CLIENT_DELETED' and user_id = '7a000000-0000-4000-8000-000000000002'), 1,
  'client deletion is recorded');
select is((select count(*)::int from audit where action = 'MEMBER_REMOVED' and target_user_id = '7a000000-0000-4000-8000-000000000003'), 1,
  'removing a member is recorded');

-- sa2 acted, then is deactivated; sa still reads everything about iv and by sa2.
update public.profiles set is_active = false where id = '7a000000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims to '{"sub":"7a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.activity_logs where target_user_id = '7a000000-0000-4000-8000-000000000004'
           and action in ('EMPLOYEE_ROLE_CHANGED', 'EMPLOYEE_DEACTIVATED', 'EMPLOYEE_REACTIVATED', 'EMPLOYEE_UPDATED')), 6,
  'the super admin still reads the deactivated employee''s audit history');
select is((select count(*)::int from public.activity_logs where user_id = '7a000000-0000-4000-8000-000000000002'), 4,
  'entries by a since-deactivated super admin keep their actor');
reset role;
set local request.jwt.claims to '';

-- Deleting the whole workspace still works (cascaded events are not logged).
select lives_ok($$ delete from public.workspaces where id = '7b000000-0000-4000-8000-000000000001' $$,
  'a workspace can still be deleted');

select * from finish();
rollback;
