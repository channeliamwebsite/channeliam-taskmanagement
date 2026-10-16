-- Migration 008 + existing rules: task creation for every role, assignment
-- limits, manager visibility, and meeting-link access for every role.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('e1111111-1111-1111-1111-111111111111', 'sa@tc.test', '{"full_name":"SA"}'),
  ('e2222222-2222-2222-2222-222222222222', 'ad@tc.test', '{"full_name":"AD"}'),
  ('e6666666-6666-6666-6666-666666666666', 'ad2@tc.test', '{"full_name":"AD2"}'),
  ('e3333333-3333-3333-3333-333333333333', 'iv@tc.test', '{"full_name":"IV"}'),
  ('e4444444-4444-4444-4444-444444444444', 'i2@tc.test', '{"full_name":"I2"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'e1111111-1111-1111-1111-111111111111';
update public.profiles set role = 'ADMIN' where id in ('e2222222-2222-2222-2222-222222222222', 'e6666666-6666-6666-6666-666666666666');
update public.profiles set team = 'Creatives', manager_id = 'e2222222-2222-2222-2222-222222222222'
  where id = 'e3333333-3333-3333-3333-333333333333';
update public.profiles set team = 'News Desk' where id = 'e4444444-4444-4444-4444-444444444444';

insert into public.workspaces (id, name, created_by) values
  ('f1000000-0000-0000-0000-000000000001', 'TC', 'e1111111-1111-1111-1111-111111111111');
insert into public.workspace_members (workspace_id, user_id) values
  ('f1000000-0000-0000-0000-000000000001', 'e2222222-2222-2222-2222-222222222222'),
  ('f1000000-0000-0000-0000-000000000001', 'e6666666-6666-6666-6666-666666666666'),
  ('f1000000-0000-0000-0000-000000000001', 'e3333333-3333-3333-3333-333333333333'),
  ('f1000000-0000-0000-0000-000000000001', 'e4444444-4444-4444-4444-444444444444');
insert into public.projects (id, workspace_id, name, created_by) values
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Client work', 'e1111111-1111-1111-1111-111111111111'),
  ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000001', 'Not mine', 'e1111111-1111-1111-1111-111111111111');

set local role authenticated;

-- Super admin: create and assign anyone
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  select public.create_task('f2000000-0000-0000-0000-000000000001', 'SA assigns IV',
    array['e3333333-3333-3333-3333-333333333333']::uuid[])
$$, 'super admin creates a task for an individual');
select lives_ok($$
  select public.create_task((select id from public.projects where workspace_id = 'f1000000-0000-0000-0000-000000000001' and is_default),
    'SA own task', array['e1111111-1111-1111-1111-111111111111']::uuid[])
$$, 'super admin creates a task for themselves');

-- Admin: own task, assign an individual, assign another admin
set local request.jwt.claims to '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$
  select public.create_task((select id from public.projects where workspace_id = 'f1000000-0000-0000-0000-000000000001' and is_default),
    'AD own task', array['e2222222-2222-2222-2222-222222222222']::uuid[])
$$, 'admin creates a task for themselves');
select lives_ok($$
  select public.create_task('f2000000-0000-0000-0000-000000000001', 'AD assigns AD2',
    array['e6666666-6666-6666-6666-666666666666']::uuid[])
$$, 'admin assigns a task to another admin');
select lives_ok($$
  select public.create_task('f2000000-0000-0000-0000-000000000001', 'AD assigns I2',
    array['e4444444-4444-4444-4444-444444444444']::uuid[])
$$, 'admin assigns a task to an individual');

set local request.jwt.claims to '{"sub":"e6666666-6666-6666-6666-666666666666","role":"authenticated"}';
select is((select count(*)::int from public.task_assignees ta join public.tasks t on t.id = ta.task_id
           where t.title = 'AD assigns AD2' and ta.user_id = 'e6666666-6666-6666-6666-666666666666'), 1,
          'the assigned admin sees the task in their assignments');

-- Individual: self tasks only
set local request.jwt.claims to '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$
  select public.create_task((select id from public.projects where workspace_id = 'f1000000-0000-0000-0000-000000000001' and is_default),
    'IV own task', array['e3333333-3333-3333-3333-333333333333']::uuid[], null, null, 'desc', 'TODO', 'HIGH', 'TASK',
    current_date, current_date, current_date + 1)
$$, 'individual creates a task for themselves with dates and priority');
select is((select count(*)::int from public.task_assignees ta join public.tasks t on t.id = ta.task_id
           where t.title = 'IV own task' and ta.user_id = 'e3333333-3333-3333-3333-333333333333' and ta.assigned_at is not null), 1,
          'individual''s own task is assigned to them with an assignment time');
select throws_ok($$
  select public.create_task((select id from public.projects where workspace_id = 'f1000000-0000-0000-0000-000000000001' and is_default),
    'IV assigns I2', array['e4444444-4444-4444-4444-444444444444']::uuid[])
$$, '42501', null, 'individual cannot assign work to another employee');
select throws_ok($$
  select public.create_task((select id from public.projects where workspace_id = 'f1000000-0000-0000-0000-000000000001' and is_default),
    'IV assigns self+I2', array['e3333333-3333-3333-3333-333333333333', 'e4444444-4444-4444-4444-444444444444']::uuid[])
$$, '42501', null, 'individual cannot add other assignees alongside themselves');
select lives_ok($$
  select public.create_task('f2000000-0000-0000-0000-000000000001', 'IV client task',
    array['e3333333-3333-3333-3333-333333333333']::uuid[])
$$, 'individual adds a self task to a client project they work on');
select throws_ok($$
  select public.create_task('f2000000-0000-0000-0000-000000000002', 'IV sneaks in',
    array['e3333333-3333-3333-3333-333333333333']::uuid[])
$$, '42501', null, 'individual cannot add tasks to a project they have no access to');
select lives_ok($$
  select public.create_task((select project_id from public.tasks where title = 'IV own task'), 'IV subtask',
    array['e3333333-3333-3333-3333-333333333333']::uuid[], null, (select id from public.tasks where title = 'IV own task'))
$$, 'individual adds a subtask under their own task');
select throws_ok($$
  select public.create_task('f2000000-0000-0000-0000-000000000001', 'IV subtask on SA task',
    array['e3333333-3333-3333-3333-333333333333']::uuid[], null, (select id from public.tasks where title = 'SA assigns IV'))
$$, '42501', null, 'individual cannot add subtasks under someone else''s task');
select is((select count(*)::int from public.tasks t join public.task_assignees ta on ta.task_id = t.id
           where ta.user_id = 'e3333333-3333-3333-3333-333333333333'), 4,
          'individual sees all their tasks (assigned + self-created) for My Tasks / calendar');

-- Reporting manager and super admin see the individual's self-created work
set local request.jwt.claims to '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.tasks where title in ('IV own task', 'IV client task', 'IV subtask')), 3,
          'reporting manager sees tasks their direct report created');
set local request.jwt.claims to '{"sub":"e6666666-6666-6666-6666-666666666666","role":"authenticated"}';
select is((select count(*)::int from public.tasks where title in ('IV own task', 'IV subtask')), 0,
          'an unrelated admin does not see them');
set local request.jwt.claims to '{"sub":"e1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.tasks where title in ('IV own task', 'IV client task', 'IV subtask')), 3,
          'super admin sees them');

-- ---------------------------------------------------------------------------
-- Meeting links: everyone reads relevant links; only super admins manage
-- ---------------------------------------------------------------------------
insert into public.meeting_links (workspace_id, title, url, kind, starts_at, created_by, team) values
  ('f1000000-0000-0000-0000-000000000001', 'All hands morning', 'https://meet.example.test/am', 'MORNING', '09:30', 'e1111111-1111-1111-1111-111111111111', null),
  ('f1000000-0000-0000-0000-000000000001', 'Creatives evening', 'https://meet.example.test/cr', 'EVENING', '18:00', 'e1111111-1111-1111-1111-111111111111', 'Creatives'),
  ('f1000000-0000-0000-0000-000000000001', 'Desk evening', 'https://meet.example.test/nd', 'EVENING', '18:30', 'e1111111-1111-1111-1111-111111111111', 'News Desk');
select is((select count(*)::int from public.meeting_links where workspace_id = 'f1000000-0000-0000-0000-000000000001'), 3,
          'super admin sees and creates meeting links');

set local request.jwt.claims to '{"sub":"e2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.meeting_links where workspace_id = 'f1000000-0000-0000-0000-000000000001'), 3,
          'admin sees meeting links');
select throws_ok($$
  insert into public.meeting_links (workspace_id, title, url, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'Admin meeting', 'https://meet.example.test/x', 'e2222222-2222-2222-2222-222222222222')
$$, '42501', null, 'admin cannot create meeting links');

set local request.jwt.claims to '{"sub":"e3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select array_agg(title order by title) from public.meeting_links where workspace_id = 'f1000000-0000-0000-0000-000000000001'),
          array['All hands morning', 'Creatives evening'],
          'individual sees the organisation-wide and their own department''s meetings');
select throws_ok($$
  insert into public.meeting_links (workspace_id, title, url, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'Mine', 'https://meet.example.test/y', 'e3333333-3333-3333-3333-333333333333')
$$, '42501', null, 'individual cannot create meeting links');
update public.meeting_links set url = 'https://evil.example.test' where title = 'All hands morning';
delete from public.meeting_links where title = 'All hands morning';

set local request.jwt.claims to '{"sub":"e4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is((select array_agg(title order by title) from public.meeting_links where workspace_id = 'f1000000-0000-0000-0000-000000000001'),
          array['All hands morning', 'Desk evening'],
          'another department sees its own meeting, not Creatives''');
select is((select url from public.meeting_links where title = 'All hands morning'), 'https://meet.example.test/am',
          'individuals cannot edit or delete meeting links');

select * from finish();
rollback;
