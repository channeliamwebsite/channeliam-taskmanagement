-- Migration 030: project-level access for people from another workspace.
-- Granted and revoked by super admins only (audited); a collaborator sees only
-- the project and the tasks assigned to them, never the rest of the workspace;
-- revoking is refused while open assignments remain.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres)
--   W1: ad1 (admin), iv1 (individual); projects P1 (granted) and P2; client C1
--   W2: co (individual, collaborator on P1), ad2 (admin)
--   sa = super admin (member of nothing)        off = deactivated employee
insert into auth.users (id, email, raw_user_meta_data) values
  ('f7000000-0000-4000-8000-000000000001', 'sa@pc.test', '{"full_name":"SA"}'),
  ('f7000000-0000-4000-8000-000000000002', 'ad1@pc.test', '{"full_name":"AD1"}'),
  ('f7000000-0000-4000-8000-000000000003', 'iv1@pc.test', '{"full_name":"IV1"}'),
  ('f7000000-0000-4000-8000-000000000004', 'co@pc.test', '{"full_name":"CO"}'),
  ('f7000000-0000-4000-8000-000000000005', 'ad2@pc.test', '{"full_name":"AD2"}'),
  ('f7000000-0000-4000-8000-000000000006', 'off@pc.test', '{"full_name":"OFF"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'f7000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id in ('f7000000-0000-4000-8000-000000000002', 'f7000000-0000-4000-8000-000000000005');
update public.profiles set is_active = false where id = 'f7000000-0000-4000-8000-000000000006';
insert into public.workspaces (id, name, created_by) values
  ('f8000000-0000-4000-8000-000000000001', 'PC One', 'f7000000-0000-4000-8000-000000000001'),
  ('f8000000-0000-4000-8000-000000000002', 'PC Two', 'f7000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id) values
  ('f8000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000002'),
  ('f8000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000003'),
  ('f8000000-0000-4000-8000-000000000002', 'f7000000-0000-4000-8000-000000000004'),
  ('f8000000-0000-4000-8000-000000000002', 'f7000000-0000-4000-8000-000000000005');
insert into public.clients (id, workspace_id, name) values
  ('f9000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000001', 'C1');
insert into public.projects (id, workspace_id, name, client_id, created_by) values
  ('fa000000-0000-4000-8000-000000000001', 'f8000000-0000-4000-8000-000000000001', 'P1', 'f9000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000002'),
  ('fa000000-0000-4000-8000-000000000002', 'f8000000-0000-4000-8000-000000000001', 'P2', 'f9000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000002');
insert into public.tasks (id, project_id, title, created_by) values
  ('fb000000-0000-4000-8000-000000000009', 'fa000000-0000-4000-8000-000000000001', 'P1 task for iv1', 'f7000000-0000-4000-8000-000000000002');
insert into public.task_assignees (task_id, user_id, is_primary) values
  ('fb000000-0000-4000-8000-000000000009', 'f7000000-0000-4000-8000-000000000003', true);
insert into public.daily_reports (user_id, workspace_id, report_date, accomplishments, evening_submitted_at) values
  ('f7000000-0000-4000-8000-000000000003', 'f8000000-0000-4000-8000-000000000001', '2026-10-20', 'W1 work', '2026-10-20 18:00+05:30');
insert into public.meeting_links (workspace_id, title, url) values
  ('f8000000-0000-4000-8000-000000000001', 'W1 stand-up', 'https://meet.example.com/w1');

set local role authenticated;

-- Only super admins grant
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$
  insert into public.project_collaborators (project_id, user_id, granted_by)
  values ('fa000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000004', 'f7000000-0000-4000-8000-000000000002')
$$, '42501', null, 'an admin cannot grant project access');
select throws_ok($$
  select public.create_task('fa000000-0000-4000-8000-000000000001', 'Too early', array['f7000000-0000-4000-8000-000000000004']::uuid[])
$$, '23514', null, 'without a grant a person from another workspace cannot be assigned');
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$
  insert into public.project_collaborators (project_id, user_id, granted_by)
  values ('fa000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000004', 'f7000000-0000-4000-8000-000000000004')
$$, '42501', null, 'nobody can grant themselves access');

set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$
  insert into public.project_collaborators (project_id, user_id, granted_by)
  values ('fa000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000004', 'f7000000-0000-4000-8000-000000000001')
$$, 'a super admin (not a member) grants access to one project');
select throws_ok($$
  insert into public.project_collaborators (project_id, user_id, granted_by)
  values ('fa000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000003', 'f7000000-0000-4000-8000-000000000001')
$$, '23514', null, 'a member of the workspace needs no grant');
select throws_ok($$
  insert into public.project_collaborators (project_id, user_id, granted_by)
  values ('fa000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000006', 'f7000000-0000-4000-8000-000000000001')
$$, '23514', null, 'a deactivated employee cannot be granted access');
select is((select count(*)::int from public.workspace_members where user_id = 'f7000000-0000-4000-8000-000000000004'
           and workspace_id = 'f8000000-0000-4000-8000-000000000001'), 0, 'the grant does not make them a member');

-- The task manager assigns the collaborator, only in the granted project
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$
  select public.create_task('fa000000-0000-4000-8000-000000000001', 'Shared work', array['f7000000-0000-4000-8000-000000000004']::uuid[])
$$, 'the admin managing the project assigns the collaborator');
select throws_ok($$
  select public.create_task('fa000000-0000-4000-8000-000000000002', 'Other project', array['f7000000-0000-4000-8000-000000000004']::uuid[])
$$, '23514', null, 'but not in another project of the workspace');
select is((select count(*)::int from public.project_collaborators where project_id = 'fa000000-0000-4000-8000-000000000001'), 1,
  'the admin sees who has access to the project');
create temporary table shared as select id from public.tasks where title = 'Shared work';

-- The collaborator: their task and project only
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select array_agg(title order by title) from public.tasks where workspace_id = 'f8000000-0000-4000-8000-000000000001'),
  array['Shared work'], 'the collaborator sees only the task assigned to them');
select is((select array_agg(name order by name) from public.projects where workspace_id = 'f8000000-0000-4000-8000-000000000001'),
  array['P1'], 'and only the granted project');
select is((select format('%s|%s|%s|%s|%s',
    (select count(*) from public.workspaces where id = 'f8000000-0000-4000-8000-000000000001'),
    (select count(*) from public.workspace_members where workspace_id = 'f8000000-0000-4000-8000-000000000001'),
    (select count(*) from public.clients where workspace_id = 'f8000000-0000-4000-8000-000000000001'),
    (select count(*) from public.daily_reports where workspace_id = 'f8000000-0000-4000-8000-000000000001'),
    (select count(*) from public.meeting_links where workspace_id = 'f8000000-0000-4000-8000-000000000001'))),
  '0|0|0|0|0', 'nothing else of the workspace: not the workspace, members, clients, reports or meetings');
select ok(exists (select 1 from public.profiles where id = 'f7000000-0000-4000-8000-000000000002'),
  'they see who assigned the task');
select ok(not exists (select 1 from public.profiles where id = 'f7000000-0000-4000-8000-000000000003'),
  'but not other members of the workspace');
select lives_ok($$
  insert into public.task_comments (task_id, user_id, comment)
  select id, 'f7000000-0000-4000-8000-000000000004', 'On it' from shared
$$, 'they comment on their task');
select lives_ok($$ update public.tasks set status = 'IN_PROGRESS' where id = (select id from shared) $$,
  'they update its status');
select throws_ok($$ update public.tasks set title = 'Renamed' where id = (select id from shared) $$,
  null, null, 'but cannot edit it beyond status and progress');
select throws_ok($$
  insert into public.task_assignees (task_id, user_id) select id, 'f7000000-0000-4000-8000-000000000005' from shared
$$, null, null, 'nor assign others');

-- Another workspace's admin sees nothing of it
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.project_collaborators), 0, 'an admin of another workspace cannot see the grants');
select is((select count(*)::int from public.tasks where workspace_id = 'f8000000-0000-4000-8000-000000000001'), 0,
  'nor the tasks of the other workspace');

-- Revocation: refused while the assignment is open, allowed once it is done
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$
  delete from public.project_collaborators where project_id = 'fa000000-0000-4000-8000-000000000001' and user_id = 'f7000000-0000-4000-8000-000000000004'
$$, '55000', null, 'access cannot be revoked while the person has open assignments');
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ update public.tasks set status = 'COMPLETED' where id = (select id from shared) $$, 'the work is completed');
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.project_collaborators where project_id = 'fa000000-0000-4000-8000-000000000001';
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$
  delete from public.project_collaborators where project_id = 'fa000000-0000-4000-8000-000000000001' and user_id = 'f7000000-0000-4000-8000-000000000004'
  returning user_id::text
$$, $$ values ('f7000000-0000-4000-8000-000000000004'::text) $$, 'then a super admin revokes it (an admin could not)');
set local request.jwt.claims to '{"sub":"f7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.tasks where workspace_id = 'f8000000-0000-4000-8000-000000000001'), 0,
  'after revocation the collaborator sees nothing of the workspace');
select is((select count(*)::int from public.projects where workspace_id = 'f8000000-0000-4000-8000-000000000001'), 0,
  'not even the project');

reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.task_assignees where task_id = (select id from shared)), 1,
  'the completed assignment is kept as history');
select is((select string_agg(action::text, ',' order by action) from public.activity_logs
           where workspace_id = 'f8000000-0000-4000-8000-000000000001' and target_user_id = 'f7000000-0000-4000-8000-000000000004'
             and user_id = 'f7000000-0000-4000-8000-000000000001' and project_id = 'fa000000-0000-4000-8000-000000000001'),
  'COLLABORATOR_ADDED,COLLABORATOR_REMOVED', 'the grant and the revocation are audited with the super admin as actor');

select * from finish();
rollback;
