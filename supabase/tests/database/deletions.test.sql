-- Deleting clients, projects, tasks, assignees, meeting schedules and meeting
-- records: who may delete, what is removed with it and what is kept.
-- Valid after 014. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). W: sa (creator, super admin, existing member), adm,
-- ind. W2: s2, a super admin who is deactivated below. Since 025 super admins
-- are company-level, so the cross-workspace attempt is made by a deactivated
-- super admin (an active one may delete in any workspace).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8d000000-0000-4000-8000-000000000001', 'sa@del.test', '{"full_name":"SA"}'),
  ('8d000000-0000-4000-8000-000000000002', 'adm@del.test', '{"full_name":"ADM"}'),
  ('8d000000-0000-4000-8000-000000000003', 'ind@del.test', '{"full_name":"IND"}'),
  ('8d000000-0000-4000-8000-000000000004', 's2@del.test', '{"full_name":"S2"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('8d000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000004');
update public.profiles set role = 'ADMIN' where id = '8d000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by) values
  ('9d000000-0000-4000-8000-000000000001', 'DEL', '8d000000-0000-4000-8000-000000000001'),
  ('9d000000-0000-4000-8000-000000000002', 'DEL two', '8d000000-0000-4000-8000-000000000004');
insert into public.workspace_members (workspace_id, user_id) values
  ('9d000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001'),
  ('9d000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000002'),
  ('9d000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000003');

insert into public.clients (id, workspace_id, name, created_by) values
  ('cd000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'With projects', '8d000000-0000-4000-8000-000000000001'),
  ('cd000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', 'No projects', '8d000000-0000-4000-8000-000000000001');
insert into public.projects (id, workspace_id, name, client_id, created_by) values
  ('ad000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'Doomed', 'cd000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001'),
  ('ad000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', 'Kept', 'cd000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001');
-- Doomed: parent P with subtask S; Kept: task K (depends on P) and task L.
insert into public.tasks (id, workspace_id, project_id, parent_task_id, title, created_by) values
  ('bd000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', null, 'P', '8d000000-0000-4000-8000-000000000002'),
  ('bd000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000001', 'S', '8d000000-0000-4000-8000-000000000002'),
  ('bd000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000002', null, 'K', '8d000000-0000-4000-8000-000000000001'),
  ('bd000000-0000-4000-8000-000000000004', '9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000002', null, 'L', '8d000000-0000-4000-8000-000000000001');
insert into public.task_assignees (task_id, user_id, is_primary) values
  ('bd000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000003', true),
  ('bd000000-0000-4000-8000-000000000003', '8d000000-0000-4000-8000-000000000003', true),
  ('bd000000-0000-4000-8000-000000000003', '8d000000-0000-4000-8000-000000000002', false);
insert into public.task_comments (task_id, user_id, comment) values
  ('bd000000-0000-4000-8000-000000000002', '8d000000-0000-4000-8000-000000000003', 'on S'),
  ('bd000000-0000-4000-8000-000000000003', '8d000000-0000-4000-8000-000000000003', 'on K');
insert into public.time_entries (task_id, user_id, started_at, ended_at, duration_minutes) values
  ('bd000000-0000-4000-8000-000000000002', '8d000000-0000-4000-8000-000000000003', '2026-10-26 04:00+00', '2026-10-26 06:00+00', 120),
  ('bd000000-0000-4000-8000-000000000003', '8d000000-0000-4000-8000-000000000003', '2026-10-26 07:00+00', '2026-10-26 08:00+00', 60);
insert into public.task_dependencies (task_id, depends_on_task_id) values
  ('bd000000-0000-4000-8000-000000000003', 'bd000000-0000-4000-8000-000000000001');
insert into public.meeting_links (id, workspace_id, title, url, created_by) values
  ('5d000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', 'Stand-up', 'https://meet.example.com/a', '8d000000-0000-4000-8000-000000000001'),
  ('5d000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', 'Review', 'https://meet.example.com/b', '8d000000-0000-4000-8000-000000000001');
insert into public.meeting_records (id, workspace_id, meeting_link_id, meeting_date, notes) values
  ('6d000000-0000-4000-8000-000000000001', '9d000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000001', '2026-10-26', 'a1'),
  ('6d000000-0000-4000-8000-000000000002', '9d000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000001', '2026-10-27', 'a2'),
  ('6d000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000002', '2026-10-27', 'b1');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Unauthorized and cross-workspace attempts delete nothing (RLS: 0 rows).
-- Admins may delete clients (019; tested in admin_operations), so the admin
-- here only attempts what they still may not delete.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000002","role":"authenticated"}';
delete from public.projects where id = 'ad000000-0000-4000-8000-000000000002';
delete from public.meeting_links where id = '5d000000-0000-4000-8000-000000000002';
delete from public.meeting_records where id = '6d000000-0000-4000-8000-000000000003';
delete from public.tasks where id = 'bd000000-0000-4000-8000-000000000004'; -- created by sa
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000003","role":"authenticated"}';
delete from public.task_assignees where task_id = 'bd000000-0000-4000-8000-000000000003';
delete from public.tasks where id = 'bd000000-0000-4000-8000-000000000003';
reset role;
set local request.jwt.claims to '';
update public.profiles set is_active = false where id = '8d000000-0000-4000-8000-000000000004';
set local role authenticated;
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000004","role":"authenticated"}';
delete from public.clients where id = 'cd000000-0000-4000-8000-000000000002';
delete from public.projects where id = 'ad000000-0000-4000-8000-000000000002';
delete from public.tasks where id = 'bd000000-0000-4000-8000-000000000004';
delete from public.meeting_links where id = '5d000000-0000-4000-8000-000000000002';
delete from public.meeting_records where id = '6d000000-0000-4000-8000-000000000003';
reset role;
set local request.jwt.claims to '';
select is(
  (select format('%s|%s|%s|%s|%s|%s',
     (select count(*) from public.clients where workspace_id = '9d000000-0000-4000-8000-000000000001'),
     (select count(*) from public.projects where workspace_id = '9d000000-0000-4000-8000-000000000001' and not is_default),
     (select count(*) from public.tasks where workspace_id = '9d000000-0000-4000-8000-000000000001'),
     (select count(*) from public.task_assignees where task_id = 'bd000000-0000-4000-8000-000000000003'),
     (select count(*) from public.meeting_links where workspace_id = '9d000000-0000-4000-8000-000000000001'),
     (select count(*) from public.meeting_records where workspace_id = '9d000000-0000-4000-8000-000000000001'))),
  '2|2|4|2|2|3',
  'admins (projects, others'' tasks, meetings), individuals and a deactivated super admin (clients too) delete nothing');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Clients: blocked while projects reference them; projects are never detached.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ delete from public.clients where id = 'cd000000-0000-4000-8000-000000000001' $$, '23503', null,
  'a client that still has projects cannot be deleted');
select is((select count(*)::int from public.projects where client_id = 'cd000000-0000-4000-8000-000000000001'), 2,
  'its projects keep their client');
select results_eq($$ delete from public.clients where id = 'cd000000-0000-4000-8000-000000000002' returning name $$,
  $$ values ('No projects'::text) $$, 'a super admin deletes a client without projects');
select is_empty($$ delete from public.clients where id = 'cd000000-0000-4000-8000-000000000002' returning id $$,
  'deleting the same client again deletes nothing');

-- ---------------------------------------------------------------------------
-- Assignees: removing one assignment keeps the task, the other assignee and the user.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000002","role":"authenticated"}';
select results_eq($$ delete from public.task_assignees
  where task_id = 'bd000000-0000-4000-8000-000000000003' and user_id = '8d000000-0000-4000-8000-000000000003' returning user_id $$,
  $$ values ('8d000000-0000-4000-8000-000000000003'::uuid) $$, 'an admin assigned to a task removes one assignee');
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select format('%s|%s',
    (select count(*) from public.task_assignees where task_id = 'bd000000-0000-4000-8000-000000000003'),
    (select count(*) from public.tasks where id = 'bd000000-0000-4000-8000-000000000003'))),
  '1|1', 'the task and its other assignee remain');
reset role;
select is((select count(*)::int from public.profiles where id = '8d000000-0000-4000-8000-000000000003' and is_active), 1,
  'the unassigned user still exists and is active');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Tasks (027): a task with history is cancelled, not deleted; a task created
-- by mistake, with no history, can still be deleted.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ delete from public.tasks where id = 'bd000000-0000-4000-8000-000000000001' $$,
  '55000', null, 'a task with a subtask, comments and time cannot be deleted');
select throws_ok($$ delete from public.tasks where id = 'bd000000-0000-4000-8000-000000000002' $$,
  '55000', null, 'a subtask with comments and time cannot be deleted either');
select lives_ok($$ update public.tasks set status = 'CANCELLED' where id = 'bd000000-0000-4000-8000-000000000001' $$,
  'the task can be cancelled instead');
insert into public.tasks (id, workspace_id, project_id, title, created_by) values
  ('bd000000-0000-4000-8000-000000000006', '9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000002', 'Typo', '8d000000-0000-4000-8000-000000000002');
select results_eq($$ delete from public.tasks where id = 'bd000000-0000-4000-8000-000000000006' returning title $$,
  $$ values ('Typo'::text) $$, 'a task without history can still be deleted by its creator');
reset role;
select is(
  (select format('%s|%s|%s|%s|%s',
     (select count(*) from public.tasks where id in ('bd000000-0000-4000-8000-000000000001', 'bd000000-0000-4000-8000-000000000002')),
     (select count(*) from public.task_comments where comment = 'on S'),
     (select count(*) from public.time_entries where task_id = 'bd000000-0000-4000-8000-000000000002'),
     (select count(*) from public.task_dependencies where depends_on_task_id = 'bd000000-0000-4000-8000-000000000001'),
     (select count(*) from public.tasks where id = 'bd000000-0000-4000-8000-000000000003'))),
  '2|1|1|1|1',
  'the refused deletion kept the task, its subtask, comments, time entries and dependency links');
select is((select format('%s|%s',
    (select count(*) from public.task_comments where comment = 'on K'),
    (select count(*) from public.time_entries where task_id = 'bd000000-0000-4000-8000-000000000003'))),
  '1|1', 'unrelated comments and time entries are kept');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Projects: only that project's tasks go; the default project is protected.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000001","role":"authenticated"}';
insert into public.tasks (id, workspace_id, project_id, title, created_by) values
  ('bd000000-0000-4000-8000-000000000005', '9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', 'Q', '8d000000-0000-4000-8000-000000000001');
select throws_ok($$ delete from public.projects where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '55000', null, 'a project with tasks cannot be deleted, even by a super admin (027)');
select is((select format('%s|%s',
    (select count(*) from public.tasks where project_id = 'ad000000-0000-4000-8000-000000000001'),
    (select count(*) from public.tasks where project_id = 'ad000000-0000-4000-8000-000000000002'))),
  '3|2', 'every task of both projects is kept');
select lives_ok($$ update public.projects set status = 'ARCHIVED' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  'the project is archived instead');
select throws_ok($$
  select public.create_task('ad000000-0000-4000-8000-000000000001', 'After archive', array['8d000000-0000-4000-8000-000000000003']::uuid[])
$$, '42501', null, 'an archived project takes no new tasks');
insert into public.projects (id, workspace_id, name, client_id, created_by) values
  ('ad000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', 'Empty', 'cd000000-0000-4000-8000-000000000001', '8d000000-0000-4000-8000-000000000001');
select results_eq($$ delete from public.projects where id = 'ad000000-0000-4000-8000-000000000003' returning name $$,
  $$ values ('Empty'::text) $$, 'an empty project can still be deleted');
select throws_ok($$ delete from public.projects where workspace_id = '9d000000-0000-4000-8000-000000000001' and is_default $$,
  '23514', 'The default General project cannot be deleted', 'the General project cannot be deleted');

-- ---------------------------------------------------------------------------
-- Meeting schedules and records (super admins of the workspace).
-- ---------------------------------------------------------------------------
select results_eq($$ delete from public.meeting_records where id = '6d000000-0000-4000-8000-000000000003' returning notes $$,
  $$ values ('b1'::text) $$, 'a super admin deletes one meeting record');
select is((select count(*)::int from public.meeting_links where id = '5d000000-0000-4000-8000-000000000002'), 1,
  'deleting a record keeps the meeting schedule');
-- Since 031 a meeting with records cannot be deleted by a signed-in user; it is
-- deactivated instead, or its records are removed explicitly first.
select throws_ok($$ delete from public.meeting_links where id = '5d000000-0000-4000-8000-000000000001' $$,
  '55000', null, 'a super admin cannot delete a meeting schedule that still has records (031)');
select is((select count(*)::int from public.meeting_records where meeting_link_id = '5d000000-0000-4000-8000-000000000001'), 2,
  'its records are kept');
select lives_ok($$ update public.meeting_links set is_active = false where id = '5d000000-0000-4000-8000-000000000001' $$,
  'the schedule is deactivated instead');
delete from public.meeting_records where meeting_link_id = '5d000000-0000-4000-8000-000000000001';
select results_eq($$ delete from public.meeting_links where id = '5d000000-0000-4000-8000-000000000001' returning title $$,
  $$ values ('Stand-up'::text) $$, 'once its records are removed explicitly, a super admin deletes the schedule');
select is_empty($$ delete from public.meeting_links where id = '5d000000-0000-4000-8000-000000000001' returning id $$,
  'deleting the same schedule again deletes nothing');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- 027: report and meeting references count as history.
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims to '';
insert into public.tasks (id, workspace_id, project_id, title, created_by) values
  ('bd000000-0000-4000-8000-000000000007', '9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000002', 'Planned', '8d000000-0000-4000-8000-000000000001'),
  ('bd000000-0000-4000-8000-000000000008', '9d000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000002', 'Follow-up', '8d000000-0000-4000-8000-000000000001');
insert into public.daily_reports (user_id, workspace_id, report_date, planned_task_ids, morning_submitted_at)
values ('8d000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000001', '2026-10-28',
        array['bd000000-0000-4000-8000-000000000007']::uuid[], '2026-10-28 09:00+05:30');
insert into public.meeting_links (id, workspace_id, title, url) values
  ('5d000000-0000-4000-8000-000000000009', '9d000000-0000-4000-8000-000000000001', 'Retro', 'https://meet.example.com/r');
insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date, follow_up_task_ids) values
  ('9d000000-0000-4000-8000-000000000001', '5d000000-0000-4000-8000-000000000009', '2026-10-28',
   array['bd000000-0000-4000-8000-000000000008']::uuid[]);
set local role authenticated;
set local request.jwt.claims to '{"sub":"8d000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ delete from public.tasks where id = 'bd000000-0000-4000-8000-000000000007' $$,
  '55000', null, 'a task named in a daily report cannot be deleted');
select throws_ok($$ delete from public.tasks where id = 'bd000000-0000-4000-8000-000000000008' $$,
  '55000', null, 'a meeting follow-up task cannot be deleted');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Everything else is untouched; the super admin account and membership remain.
-- ---------------------------------------------------------------------------
select is((select format('%s|%s',
    (select role::text from public.profiles where id = '8d000000-0000-4000-8000-000000000001'),
    (select count(*) from public.workspace_members where user_id = '8d000000-0000-4000-8000-000000000001' and workspace_id = '9d000000-0000-4000-8000-000000000001'))),
  'SUPER_ADMIN|1', 'the super admin account and workspace membership are preserved');
select is((select count(*)::int from public.projects where workspace_id = '9d000000-0000-4000-8000-000000000002'), 1,
  'the other workspace is untouched');

-- Deleting a whole workspace (cascade to clients and projects) still works.
insert into public.clients (id, workspace_id, name) values ('cd000000-0000-4000-8000-000000000003', '9d000000-0000-4000-8000-000000000002', 'C2');
insert into public.projects (id, workspace_id, name, client_id) values ('ad000000-0000-4000-8000-000000000009', '9d000000-0000-4000-8000-000000000002', 'P2', 'cd000000-0000-4000-8000-000000000003');
insert into public.tasks (project_id, title) values ('ad000000-0000-4000-8000-000000000009', 'Task in W2');
select lives_ok($$ delete from public.workspaces where id = '9d000000-0000-4000-8000-000000000002' $$,
  'a workspace with clients, projects and tasks can still be deleted as a whole (without a signed-in user)');
select is((select count(*)::int from public.tasks where project_id = 'ad000000-0000-4000-8000-000000000009'), 0,
  'its tasks went with it');

select * from finish();
rollback;
