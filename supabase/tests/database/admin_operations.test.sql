-- Admin operational permissions, workspace isolation and the subtask parent
-- guard (migrations 018, 019). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres, no user). W1: sa, ad (may create projects), ad2 (may
-- not), iv. W2: sa2 and ad3 only.
insert into auth.users (id, email, raw_user_meta_data) values
  ('9a000000-0000-4000-8000-000000000001', 'sa@ops.test', '{"full_name":"SA"}'),
  ('9a000000-0000-4000-8000-000000000002', 'ad@ops.test', '{"full_name":"AD"}'),
  ('9a000000-0000-4000-8000-000000000003', 'ad2@ops.test', '{"full_name":"AD2"}'),
  ('9a000000-0000-4000-8000-000000000004', 'iv@ops.test', '{"full_name":"IV"}'),
  ('9a000000-0000-4000-8000-000000000005', 'sa2@ops.test', '{"full_name":"SA2"}'),
  ('9a000000-0000-4000-8000-000000000006', 'ad3@ops.test', '{"full_name":"AD3"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('9a000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000005');
update public.profiles set role = 'ADMIN' where id in ('9a000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000006');
insert into public.workspaces (id, name, created_by) values
  ('9b000000-0000-4000-8000-000000000001', 'W1', '9a000000-0000-4000-8000-000000000001'),
  ('9b000000-0000-4000-8000-000000000002', 'W2', '9a000000-0000-4000-8000-000000000005');
insert into public.workspace_members (workspace_id, user_id, can_create_projects) values
  ('9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000002', true),
  ('9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000003', false),
  ('9b000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000004', false),
  ('9b000000-0000-4000-8000-000000000002', '9a000000-0000-4000-8000-000000000006', true);
insert into public.clients (id, workspace_id, name, created_by) values
  ('9c000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', 'Acme', '9a000000-0000-4000-8000-000000000001'),
  ('9c000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000001', 'No projects yet', '9a000000-0000-4000-8000-000000000001'),
  ('9c000000-0000-4000-8000-000000000003', '9b000000-0000-4000-8000-000000000002', 'Other company', '9a000000-0000-4000-8000-000000000005');
insert into public.projects (id, workspace_id, name, client_id, created_by) values
  ('9d000000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000001', 'Acme site', '9c000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000001'),
  ('9d000000-0000-4000-8000-000000000002', '9b000000-0000-4000-8000-000000000002', 'Other site', '9c000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000005');
-- T1: the super admin's task for iv; ad has no part in it.
insert into public.tasks (id, project_id, title, created_by) values
  ('9e000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'SA task', '9a000000-0000-4000-8000-000000000001'),
  ('9e000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000002', 'Other task', '9a000000-0000-4000-8000-000000000005');
insert into public.task_assignees (task_id, user_id, assigned_by, is_primary) values
  ('9e000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000004', '9a000000-0000-4000-8000-000000000001', true);

-- ---------------------------------------------------------------------------
-- Admin: clients and projects of their own workspace, nothing of another
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select string_agg(name, ',' order by name) from public.clients), 'Acme,No projects yet',
  'the admin retrieves every client of their workspace (including one without projects), none of W2');
select is((select string_agg(name, ',' order by name) from public.projects where not is_default), 'Acme site',
  'the admin retrieves the projects of their workspace, none of W2');
select is((select c.name from public.projects p join public.clients c on c.id = p.client_id where p.id = '9d000000-0000-4000-8000-000000000001'),
  'Acme', 'the project''s client can be read with it (task dialog options)');
select is((select count(*)::int from public.tasks where id = '9e000000-0000-4000-8000-000000000003'), 0, 'the admin cannot see W2 tasks');

-- Task in an authorized client project, assigned to an employee.
select lives_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'Admin task',
    array['9a000000-0000-4000-8000-000000000004']::uuid[], null, null, null, 'TODO', 'MEDIUM', 'TASK',
    '2026-11-02', null, '2026-11-06')
$$, 'the admin creates a task in a client project and assigns an employee');
select is((select format('%s|%s', t.workspace_id, ta.user_id) from public.tasks t join public.task_assignees ta on ta.task_id = t.id
           where t.title = 'Admin task'),
  '9b000000-0000-4000-8000-000000000001|9a000000-0000-4000-8000-000000000004', 'the task is in W1 and assigned to iv');
select throws_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000002', 'Cross-workspace task', array['9a000000-0000-4000-8000-000000000004']::uuid[])
$$, '42501', null, 'the admin cannot create a task in another workspace''s project');
select throws_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'Assign outsider', array['9a000000-0000-4000-8000-000000000006']::uuid[])
$$, '23514', null, 'the admin cannot assign someone from another workspace');
select is((select count(*)::int from public.tasks where title in ('Cross-workspace task', 'Assign outsider')), 0,
  'failed task creation leaves no task behind');

-- Projects: with the per-workspace permission (approved model, unchanged).
select lives_ok($$
  insert into public.projects (workspace_id, name, client_id) values
    ('9b000000-0000-4000-8000-000000000001', 'Acme app', '9c000000-0000-4000-8000-000000000001')
$$, 'a permitted admin creates a project for a client');
select lives_ok($$ update public.projects set due_date = '2026-12-31' where name = 'Acme app' $$, 'and edits it');
select throws_ok($$
  insert into public.projects (workspace_id, name) values ('9b000000-0000-4000-8000-000000000002', 'W2 project')
$$, '42501', null, 'not in another workspace');
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$
  insert into public.projects (workspace_id, name, client_id) values
    ('9b000000-0000-4000-8000-000000000001', 'AD2 project', '9c000000-0000-4000-8000-000000000001')
$$, '42501', null, 'an admin without the permission cannot create projects');
select lives_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'AD2 task', array['9a000000-0000-4000-8000-000000000004']::uuid[])
$$, 'but can still create and assign tasks in existing client projects');

-- Clients: admins add, edit and delete (019); 014 still protects clients with projects.
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ insert into public.clients (workspace_id, name) values ('9b000000-0000-4000-8000-000000000001', 'Admin client') $$,
  'the admin adds a client');
select lives_ok($$ update public.clients set notes = 'Updated' where name = 'Admin client' $$, 'the admin edits a client');
select throws_ok($$ delete from public.clients where id = '9c000000-0000-4000-8000-000000000001' $$,
  '23503', null, 'the admin cannot delete a client that still has projects');
select results_eq($$ delete from public.clients where id = '9c000000-0000-4000-8000-000000000002' returning name $$,
  $$ values ('No projects yet'::text) $$, 'the admin deletes a client without projects');
select is_empty($$ delete from public.clients where id = '9c000000-0000-4000-8000-000000000003' returning id $$,
  'the admin cannot delete another workspace''s client');

-- ---------------------------------------------------------------------------
-- Individuals: no client or project management
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ insert into public.clients (workspace_id, name) values ('9b000000-0000-4000-8000-000000000001', 'IV client') $$,
  '42501', null, 'an individual cannot create clients');
select throws_ok($$ insert into public.projects (workspace_id, name) values ('9b000000-0000-4000-8000-000000000001', 'IV project') $$,
  '42501', null, 'an individual cannot create projects');
select is_empty($$ delete from public.clients where name = 'Admin client' returning id $$, 'an individual cannot delete clients');
select is_empty($$ update public.projects set name = 'Hacked' where id = '9d000000-0000-4000-8000-000000000001' returning id $$,
  'an individual cannot edit projects');
select throws_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'IV assigns AD', array['9a000000-0000-4000-8000-000000000002']::uuid[])
$$, '42501', null, 'an individual cannot assign work to someone else');

-- ---------------------------------------------------------------------------
-- Subtasks (018)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.tasks where id = '9e000000-0000-4000-8000-000000000001'), 0, 'the admin cannot see the super admin''s task');
select throws_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'Sneaky subtask', array['9a000000-0000-4000-8000-000000000002']::uuid[],
    null, '9e000000-0000-4000-8000-000000000001')
$$, '42501', 'You can only add subtasks to tasks you manage.', 'the admin cannot add a subtask under a task they cannot manage');
select throws_ok($$
  insert into public.tasks (project_id, parent_task_id, title)
  values ('9d000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'Direct sneaky subtask')
$$, '42501', null, 'not by a direct insert either');
select throws_ok($$
  update public.tasks set parent_task_id = '9e000000-0000-4000-8000-000000000001' where title = 'Admin task'
$$, '42501', null, 'nor by moving their own task under it');
select is((select count(*)::int from public.tasks where id = '9e000000-0000-4000-8000-000000000001'), 0,
  'the refused attempts did not make the parent visible');
select lives_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'Admin subtask', array['9a000000-0000-4000-8000-000000000004']::uuid[],
    null, (select id from public.tasks where title = 'Admin task'))
$$, 'the admin adds a subtask under a task they manage');
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.tasks where title in ('Sneaky subtask', 'Direct sneaky subtask')), 0,
  'refused subtasks left no task rows');
select is((select count(*)::int from public.task_assignees ta where not exists (select 1 from public.tasks t where t.id = ta.task_id)), 0,
  'and no assignee rows');
select is((select parent_task_id from public.tasks where title = 'Admin task'), null::uuid, 'the admin''s task was not moved');

-- An admin assigned to the task may still nest under it (M2 rule unchanged).
insert into public.task_assignees (task_id, user_id, assigned_by) values
  ('9e000000-0000-4000-8000-000000000001', '9a000000-0000-4000-8000-000000000003', '9a000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'Assigned admin subtask', array['9a000000-0000-4000-8000-000000000003']::uuid[],
    null, '9e000000-0000-4000-8000-000000000001')
$$, 'an admin assigned to the parent can add a subtask (existing manage rule)');

-- Super admins: unchanged.
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'SA subtask', array['9a000000-0000-4000-8000-000000000004']::uuid[],
    null, (select id from public.tasks where title = 'Admin task'))
$$, 'a super admin adds a subtask under any task of their workspace');
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$
  insert into public.tasks (project_id, parent_task_id, title)
  values ('9d000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'Foreign SA subtask')
$$, '42501', null, 'another workspace''s super admin cannot');

-- Individuals: unchanged (own tasks only).
set local request.jwt.claims to '{"sub":"9a000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'IV subtask on SA task', array['9a000000-0000-4000-8000-000000000004']::uuid[],
    null, '9e000000-0000-4000-8000-000000000001')
$$, '42501', null, 'an individual cannot add a subtask under a task they only work on');
select lives_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'IV own task', array['9a000000-0000-4000-8000-000000000004']::uuid[])
$$, 'an individual creates their own task in a project they work on');
select lives_ok($$
  select public.create_task('9d000000-0000-4000-8000-000000000001', 'IV own subtask', array['9a000000-0000-4000-8000-000000000004']::uuid[],
    null, (select id from public.tasks where title = 'IV own task'))
$$, 'and a subtask under it');
reset role;
set local request.jwt.claims to '';

select * from finish();
rollback;
