-- Database foundation tests. Run with: npx supabase test db
-- Everything runs in a transaction and is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
--   sa  = super admin          a1 = admin (may create projects)
--   a2  = admin                i1, i2 = individuals
--   out = admin in another workspace
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'sa@example.test',  '{"full_name":"Super Admin","role":"SUPER_ADMIN"}'),
  ('22222222-2222-2222-2222-222222222222', 'a1@example.test',  '{"full_name":"Admin One"}'),
  ('33333333-3333-3333-3333-333333333333', 'a2@example.test',  '{"full_name":"Admin Two"}'),
  ('44444444-4444-4444-4444-444444444444', 'i1@example.test',  '{"full_name":"Individual One","role":"SUPER_ADMIN"}'),
  ('55555555-5555-5555-5555-555555555555', 'i2@example.test',  '{"full_name":"Individual Two"}'),
  ('66666666-6666-6666-6666-666666666666', 'out@example.test', '{"full_name":"Outsider"}');

select is((select count(*)::int from public.profiles where email like '%@example.test'
           and id::text ~ '^(1|2|3|4|5|6)\1{7}-'), 6, 'auth trigger created a profile per user');
select is((select role from public.profiles where id = '44444444-4444-4444-4444-444444444444'),
          'INDIVIDUAL'::public.user_role, 'signup metadata cannot grant a role');
select is((select full_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
          'Admin One', 'full_name copied from signup metadata');

-- auth email changes sync to the profile without touching other fields
update public.profiles set job_title = 'Designer' where id = '55555555-5555-5555-5555-555555555555';
update auth.users set email = 'i2-new@example.test' where id = '55555555-5555-5555-5555-555555555555';
select is((select email || '|' || job_title from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
          'i2-new@example.test|Designer', 'email synced, manual profile data preserved');

update public.profiles set role = 'SUPER_ADMIN' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set role = 'ADMIN' where id in ('22222222-2222-2222-2222-222222222222',
                                                       '33333333-3333-3333-3333-333333333333',
                                                       '66666666-6666-6666-6666-666666666666');

-- Other workspace for the outsider (created as postgres)
insert into public.workspaces (id, name, created_by)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'Other Workspace', '66666666-6666-6666-6666-666666666666');

-- ---------------------------------------------------------------------------
-- Super admin: workspace + members
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select lives_ok($$
  insert into public.workspaces (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Main Workspace') returning id
$$, 'super admin creates a workspace (insert ... returning)');
select is((select count(*)::int from public.workspace_members where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
          1, 'creator auto-added as member');
select lives_ok($$
  insert into public.workspace_members (workspace_id, user_id, can_create_projects) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', true),
    ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', false),
    ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', false),
    ('aaaaaaaa-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', false)
$$, 'super admin adds members');
select throws_ok($$
  insert into public.workspace_members (workspace_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222')
$$, '23505', null, 'same user cannot join a workspace twice');
select is((select count(*)::int from public.workspaces), 1, 'super admin cannot see workspaces they are not in');
select throws_ok($$
  update public.profiles set role = 'ADMIN' where id = '11111111-1111-1111-1111-111111111111'
$$, '42501', null, 'super admin cannot change own role');

-- ---------------------------------------------------------------------------
-- Admins: projects and tasks
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok($$
  insert into public.projects (workspace_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Nope')
$$, '42501', null, 'admin without can_create_projects cannot create projects');

set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$
  insert into public.projects (id, workspace_id, name, owner_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Website Redesign',
          '22222222-2222-2222-2222-222222222222') returning id
$$, 'permitted admin creates a project');
select throws_ok($$
  insert into public.projects (workspace_id, name, owner_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Bad owner', '66666666-6666-6666-6666-666666666666')
$$, '23514', null, 'project owner must belong to the workspace');

select lives_ok($$
  insert into public.tasks (id, project_id, title) values
    ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Homepage') returning id
$$, 'admin creates a task (insert ... returning)');
select lives_ok($$
  insert into public.tasks (id, project_id, parent_task_id, title) values
    ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Hero Section'),
    ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'Desktop Design'),
    ('cccccccc-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', null, 'SEO Optimization')
$$, 'admin creates nested subtasks');
select is((select workspace_id from public.tasks where id = 'cccccccc-0000-0000-0000-000000000003'),
          'aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'task.workspace_id derived from project');

select throws_ok($$
  update public.tasks set parent_task_id = 'cccccccc-0000-0000-0000-000000000003' where id = 'cccccccc-0000-0000-0000-000000000001'
$$, '23514', 'Task hierarchy cannot contain cycles', 'hierarchy cycles rejected');
select throws_ok($$
  update public.tasks set parent_task_id = id where id = 'cccccccc-0000-0000-0000-000000000001'
$$, '23514', null, 'task cannot be its own parent');

-- Assignment: admin -> admin, admin -> individual, admin -> outsider (rejected)
select lives_ok($$
  insert into public.task_assignees (task_id, user_id, is_primary) values
    ('cccccccc-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', true),
    ('cccccccc-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', false)
$$, 'admin assigns to another admin and to an individual');
select throws_ok($$
  insert into public.task_assignees (task_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000004', '66666666-6666-6666-6666-666666666666')
$$, '23514', null, 'cannot assign a user outside the workspace');
select lives_ok($$
  update public.task_assignees set is_primary = true
  where task_id = 'cccccccc-0000-0000-0000-000000000001' and user_id = '44444444-4444-4444-4444-444444444444'
$$, 'switching primary assignee');
select is((select count(*)::int from public.task_assignees
           where task_id = 'cccccccc-0000-0000-0000-000000000001' and is_primary), 1, 'exactly one primary assignee');

-- Dependencies
select lives_ok($$
  insert into public.task_dependencies (task_id, depends_on_task_id)
  values ('cccccccc-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000001')
$$, 'dependency created');
select throws_ok($$
  insert into public.task_dependencies (task_id, depends_on_task_id)
  values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000004')
$$, '23514', 'Task dependencies cannot contain cycles', 'dependency cycles rejected');
select throws_ok($$
  insert into public.task_dependencies (task_id, depends_on_task_id)
  values ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001')
$$, '23514', null, 'task cannot depend on itself');

-- Admin 2 (assignee of Homepage) can see it and manage it: reassign to individual 2
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 3, 'assigned admin sees task + subtasks only');
select lives_ok($$
  insert into public.task_assignees (task_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555')
$$, 'admin who received a task can delegate it');
select lives_ok($$
  delete from public.task_assignees
  where task_id = 'cccccccc-0000-0000-0000-000000000001' and user_id = '55555555-5555-5555-5555-555555555555'
$$, 'admin can unassign');

-- ---------------------------------------------------------------------------
-- Individual
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 3, 'individual sees assigned task and its subtasks');
select is((select count(*)::int from public.projects), 1, 'individual sees project of assigned task');
select throws_ok($$
  insert into public.tasks (project_id, title) values ('bbbbbbbb-0000-0000-0000-000000000001', 'x')
$$, '42501', null, 'individual cannot create tasks');
select lives_ok($$
  update public.tasks set status = 'IN_PROGRESS', progress = 40 where id = 'cccccccc-0000-0000-0000-000000000001'
$$, 'individual assignee updates status/progress');
select throws_ok($$
  update public.tasks set title = 'Hacked' where id = 'cccccccc-0000-0000-0000-000000000001'
$$, '42501', null, 'individual cannot edit other task fields');
select lives_ok($$
  update public.tasks set scheduled_date = '2026-10-12' where id = 'cccccccc-0000-0000-0000-000000000001'
$$, 'individual assignee can schedule their task');
select is((select count(*)::int from public.activity_logs
           where task_id = 'cccccccc-0000-0000-0000-000000000001' and action = 'TASK_SCHEDULED'),
          1, 'scheduling change recorded in activity history');
select throws_ok($$
  insert into public.task_assignees (task_id, user_id)
  values ('cccccccc-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555')
$$, '42501', null, 'individual cannot assign');
select lives_ok($$
  insert into public.task_comments (task_id, comment) values ('cccccccc-0000-0000-0000-000000000001', 'Started on this')
$$, 'individual comments on assigned task');
select lives_ok($$
  insert into public.time_entries (task_id, started_at, ended_at)
  values ('cccccccc-0000-0000-0000-000000000001', '2026-10-07 09:00+00', '2026-10-07 10:30+00')
$$, 'individual logs time');
select throws_ok($$
  update public.profiles set role = 'ADMIN' where id = '44444444-4444-4444-4444-444444444444'
$$, '42501', null, 'individual cannot change own role');
select lives_ok($$
  update public.profiles set full_name = 'Indy One' where id = '44444444-4444-4444-4444-444444444444'
$$, 'individual updates own name');
select lives_ok($$
  insert into public.daily_reports (workspace_id, report_date, tasks_in_progress, total_hours)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-07', 1, 1.5)
$$, 'individual submits daily report');
select is((select count(*)::int from public.notifications), 1, 'individual sees only own notifications (assignment)');
select throws_ok($$
  insert into public.notifications (user_id, type, title) values ('44444444-4444-4444-4444-444444444444', 'SYSTEM', 'x')
$$, '42501', null, 'clients cannot create notifications');
select throws_ok($$
  insert into public.activity_logs (workspace_id, action) values ('aaaaaaaa-0000-0000-0000-000000000001', 'TASK_UPDATED')
$$, '42501', null, 'clients cannot forge activity logs');

-- Individual 2: not assigned to anything
set local request.jwt.claims to '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 0, 'unassigned individual sees no tasks');
select is((select count(*)::int from public.daily_reports), 0, 'individual cannot see others'' reports');
select is((select count(*)::int from public.time_entries), 0, 'individual cannot see others'' time');
select throws_ok($$
  insert into public.task_comments (task_id, comment) values ('cccccccc-0000-0000-0000-000000000001', 'sneaky')
$$, '42501', null, 'cannot comment on inaccessible task');

-- Outsider: different workspace
set local request.jwt.claims to '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 0, 'outsider sees no tasks');
select is((select count(*)::int from public.projects), 0, 'outsider sees no projects');
select is((select count(*)::int from public.profiles), 1, 'outsider sees only own profile');
select is((select count(*)::int from public.activity_logs), 0, 'outsider sees no activity');

-- ---------------------------------------------------------------------------
-- Super admin sees everything in their workspace; admin sees team reports
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 4, 'super admin sees all workspace tasks');
select ok((select count(*) from public.activity_logs) >= 8, 'activity logged for create/assign/status/comment');
select is((select actual_hours from public.tasks where id = 'cccccccc-0000-0000-0000-000000000001'),
          1.50::numeric, 'actual_hours synced from time entries');

set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports), 1, 'admin sees workspace daily reports');
select is((select count(*)::int from public.notifications where type = 'TASK_COMMENT'), 1, 'creator notified of comment');

-- Team lead visibility (004): a2 sees tasks of direct reports only after the reporting line exists
reset role;
set local request.jwt.claims to '';
insert into public.tasks (id, project_id, title, created_by)
values ('cccccccc-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000001', 'Report-only task',
        '22222222-2222-2222-2222-222222222222');
insert into public.task_assignees (task_id, user_id, assigned_by)
values ('cccccccc-0000-0000-0000-000000000009', '55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222');
set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.tasks where id = 'cccccccc-0000-0000-0000-000000000009'), 0,
          'admin cannot see an unrelated employee task');
reset role;
set local request.jwt.claims to '';
update public.profiles set manager_id = '33333333-3333-3333-3333-333333333333' where id = '55555555-5555-5555-5555-555555555555';
set local role authenticated;
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.tasks where id = 'cccccccc-0000-0000-0000-000000000009'), 1,
          'team lead sees tasks assigned to direct reports');
update public.profiles set manager_id = null where id = '55555555-5555-5555-5555-555555555555';
reset role;
select is((select manager_id from public.profiles where id = '55555555-5555-5555-5555-555555555555'),
          '33333333-3333-3333-3333-333333333333'::uuid, 'admins cannot change reporting lines (RLS filters the update)');
set local role authenticated;

-- Deactivated user loses access
reset role;
set local request.jwt.claims to '';
set local request.jwt.claims to '';
update public.profiles set is_active = false where id = '44444444-4444-4444-4444-444444444444';
set local role authenticated;
set local request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.tasks), 0, 'inactive user sees no tasks');

-- anon has no table access at all
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.tasks $$, '42501', null, 'anon has no table privileges');

-- ---------------------------------------------------------------------------
-- Structural checks
-- ---------------------------------------------------------------------------
reset role;
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0,
          'RLS enabled on every public table');
select is((select count(*)::int from pg_policies where schemaname = 'public'
           and (qual = 'true' or with_check = 'true')), 0, 'no USING (true) / WITH CHECK (true) policies');

select * from finish();
rollback;
