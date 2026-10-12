-- Daily workflow tests (migration 006): completion timestamps, default
-- scheduling, General project, self-assigned tasks, atomic assignment,
-- meeting links, reminders and client contact privacy.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1111111-1111-1111-1111-111111111111', 'sa@wf.test', '{"full_name":"SA"}'),
  ('b2222222-2222-2222-2222-222222222222', 'ad@wf.test', '{"full_name":"AD"}'),
  ('b3333333-3333-3333-3333-333333333333', 'iv@wf.test', '{"full_name":"IV"}'),
  ('b4444444-4444-4444-4444-444444444444', 'i2@wf.test', '{"full_name":"I2"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'b1111111-1111-1111-1111-111111111111';
update public.profiles set role = 'ADMIN' where id = 'b2222222-2222-2222-2222-222222222222';
update public.profiles set team = 'Production' where id = 'b3333333-3333-3333-3333-333333333333';
update public.profiles set team = 'Desk' where id = 'b4444444-4444-4444-4444-444444444444';

insert into public.workspaces (id, name, created_by, timezone)
values ('e1000000-0000-0000-0000-000000000001', 'WF', 'b1111111-1111-1111-1111-111111111111', 'Asia/Kolkata');
insert into public.workspace_members (workspace_id, user_id) values
  ('e1000000-0000-0000-0000-000000000001', 'b2222222-2222-2222-2222-222222222222'),
  ('e1000000-0000-0000-0000-000000000001', 'b3333333-3333-3333-3333-333333333333'),
  ('e1000000-0000-0000-0000-000000000001', 'b4444444-4444-4444-4444-444444444444');

-- ---------------------------------------------------------------------------
-- General project
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default), 1,
          'a new workspace gets exactly one General project');
-- Re-running the backfill must not create a second default.
insert into public.projects (workspace_id, name, status, is_default, created_by)
select w.id, 'General', 'ACTIVE', true, w.created_by from public.workspaces w
where w.id = 'e1000000-0000-0000-0000-000000000001'
  and not exists (select 1 from public.projects p where p.workspace_id = w.id and p.is_default);
select is((select count(*)::int from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default), 1,
          'repeating the General backfill is a no-op');
select throws_ok($$
  insert into public.projects (workspace_id, name, is_default) values ('e1000000-0000-0000-0000-000000000001', 'Another', true)
$$, '23505', null, 'a workspace cannot have two default projects');
select throws_ok($$
  delete from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default
$$, '23514', 'The default General project cannot be deleted', 'General project cannot be deleted directly');

-- ---------------------------------------------------------------------------
-- Admin creates a task atomically; defaults
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$
  select public.create_task(
    (select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
    'Admin task', array['b3333333-3333-3333-3333-333333333333'::uuid, 'b2222222-2222-2222-2222-222222222222'::uuid],
    'b3333333-3333-3333-3333-333333333333')
$$, 'admin creates a task with assignees in one call');
reset role;
select is((select scheduled_date from public.tasks where title = 'Admin task'), (now() at time zone 'Asia/Kolkata')::date,
          'missing scheduled date defaults to today in the workspace timezone');
select is((select count(*)::int from public.task_assignees ta join public.tasks t on t.id = ta.task_id where t.title = 'Admin task'), 2,
          'both assignees saved');
select is((select u.full_name from public.task_assignees ta join public.tasks t on t.id = ta.task_id
           join public.profiles u on u.id = ta.user_id where t.title = 'Admin task' and ta.is_primary), 'IV',
          'requested primary assignee kept');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$
  select public.create_task(
    (select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
    'Dated task', array['b2222222-2222-2222-2222-222222222222'::uuid], null, null, null, 'TODO', 'HIGH', 'TASK',
    null, '2030-02-01', '2030-02-05')
$$, 'admin creates a task with explicit dates');
select is((select scheduled_date::text || '/' || due_date::text from public.tasks where title = 'Dated task'), '2030-02-01/2030-02-05',
          'explicit scheduled and due dates preserved');
select throws_ok($$
  select public.create_task(
    (select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
    'Rolled back', array['b2222222-2222-2222-2222-222222222222'::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid])
$$, null, null, 'assigning a non-member fails');
reset role;
select is((select count(*)::int from public.tasks where title = 'Rolled back'), 0, 'failed creation leaves no orphan task');

-- ---------------------------------------------------------------------------
-- completed_at
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
update public.tasks set status = 'COMPLETED' where title = 'Admin task';
reset role;
set local request.jwt.claims to '';
select isnt((select completed_at from public.tasks where title = 'Admin task'), null, 'completing sets completed_at');
create temp table wf_completed as select completed_at from public.tasks where title = 'Admin task';
update public.tasks set progress = 80, description = 'later edit' where title = 'Admin task';
select is((select completed_at from public.tasks where title = 'Admin task'), (select completed_at from wf_completed),
          'unrelated edits keep the original completion time');
update public.tasks set status = 'IN_PROGRESS' where title = 'Admin task';
select is((select completed_at from public.tasks where title = 'Admin task'), null, 'reopening clears completed_at');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok($$
  update public.tasks set completed_at = now() - interval '5 days' where title = 'Admin task'
$$, '42501', null, 'clients cannot write completed_at');

-- ---------------------------------------------------------------------------
-- Individuals: self-assigned tasks only
-- ---------------------------------------------------------------------------
select lives_ok($$
  select public.create_task(
    (select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
    'My own task', array['b3333333-3333-3333-3333-333333333333'::uuid])
$$, 'individual creates a self-assigned task in General');
select is((select count(*)::int from public.tasks where title = 'My own task'), 1, 'individual sees their own task');
select throws_ok($$
  select public.create_task(
    (select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
    'For someone else', array['b4444444-4444-4444-4444-444444444444'::uuid])
$$, '42501', null, 'individual cannot assign a task to another user');
select throws_ok($$
  select public.create_task(
    (select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
    'Shared', array['b3333333-3333-3333-3333-333333333333'::uuid, 'b4444444-4444-4444-4444-444444444444'::uuid])
$$, '42501', null, 'individual cannot add another user alongside themselves');
reset role;
select is((select count(*)::int from public.tasks where title in ('For someone else', 'Shared')), 0,
          'rejected individual tasks were rolled back completely');
insert into public.projects (id, workspace_id, name, created_by)
values ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'Client work', 'b1111111-1111-1111-1111-111111111111');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok($$
  insert into public.tasks (project_id, workspace_id, title, created_by)
  values ('e2000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'x', 'b3333333-3333-3333-3333-333333333333')
$$, '42501', null, 'individual cannot create tasks outside the General project');
select throws_ok($$
  select public.set_task_assignees((select id from public.tasks where title = 'My own task'),
    array['b3333333-3333-3333-3333-333333333333'::uuid, 'b4444444-4444-4444-4444-444444444444'::uuid])
$$, '42501', null, 'individual cannot reassign through set_task_assignees');
select throws_ok($$
  update public.tasks set title = 'Renamed' where title = 'My own task'
$$, '42501', null, 'existing field restrictions still apply to individuals');

-- ---------------------------------------------------------------------------
-- Atomic reassignment
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$
  select public.set_task_assignees((select id from public.tasks where title = 'Admin task'),
    array['b4444444-4444-4444-4444-444444444444'::uuid], 'b4444444-4444-4444-4444-444444444444')
$$, 'admin reassigns a task');
reset role;
select is((select string_agg(u.full_name || case when ta.is_primary then '*' else '' end, ',' order by u.full_name)
           from public.task_assignees ta join public.tasks t on t.id = ta.task_id join public.profiles u on u.id = ta.user_id
           where t.title = 'Admin task'), 'I2*', 'reassignment replaced the assignee set and primary');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$
  select public.set_task_assignees((select id from public.tasks where title = 'Admin task'),
    array['b3333333-3333-3333-3333-333333333333'::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid])
$$, null, null, 'reassignment to a non-member fails');
reset role;
select is((select string_agg(u.full_name, ',') from public.task_assignees ta join public.tasks t on t.id = ta.task_id
           join public.profiles u on u.id = ta.user_id where t.title = 'Admin task'), 'I2',
          'failed reassignment left the previous assignees untouched (atomic)');

-- ---------------------------------------------------------------------------
-- Meeting links
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  insert into public.meeting_links (workspace_id, team, title, url, created_by) values
    ('e1000000-0000-0000-0000-000000000001', null, 'Daily standup', 'https://meet.example.com/standup', 'b1111111-1111-1111-1111-111111111111'),
    ('e1000000-0000-0000-0000-000000000001', 'Production', 'Production sync', 'https://meet.example.com/prod', 'b1111111-1111-1111-1111-111111111111'),
    ('e1000000-0000-0000-0000-000000000001', 'Desk', 'Desk sync', 'https://meet.example.com/desk', 'b1111111-1111-1111-1111-111111111111')
$$, 'super admin creates organisation and team meetings');
select throws_ok($$
  insert into public.meeting_links (workspace_id, title, url, created_by)
  values ('e1000000-0000-0000-0000-000000000001', 'Bad', 'javascript:alert(1)', 'b1111111-1111-1111-1111-111111111111')
$$, '23514', null, 'non-https meeting URLs are rejected');
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select string_agg(title, ',' order by title) from public.meeting_links), 'Daily standup,Production sync',
          'member sees the organisation meeting and their own team meeting only');
select throws_ok($$
  insert into public.meeting_links (workspace_id, title, url, created_by)
  values ('e1000000-0000-0000-0000-000000000001', 'Mine', 'https://x.example.com', 'b3333333-3333-3333-3333-333333333333')
$$, '42501', null, 'individuals cannot create meeting links');
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.meeting_links), 3, 'admins see all meetings in their workspace');
update public.meeting_links set url = 'https://evil.example.com'
where title = 'Daily standup' and workspace_id = 'e1000000-0000-0000-0000-000000000001';
reset role;
select is((select url from public.meeting_links where title = 'Daily standup' and workspace_id = 'e1000000-0000-0000-0000-000000000001'),
          'https://meet.example.com/standup',
          'admins cannot modify meeting links (super admin only)');

-- ---------------------------------------------------------------------------
-- Client contact privacy
-- ---------------------------------------------------------------------------
insert into public.clients (workspace_id, name, contact_email, created_by)
values ('e1000000-0000-0000-0000-000000000001', 'Acme', 'boss@acme.test', 'b1111111-1111-1111-1111-111111111111');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select name from public.clients where workspace_id = 'e1000000-0000-0000-0000-000000000001'), 'Acme',
          'members can still read client names');
select throws_ok($$ select contact_email from public.clients $$, '42501', null,
                 'members cannot read client contact columns directly');
select is((select count(*)::int from public.get_client_contacts('e1000000-0000-0000-0000-000000000001')), 0,
          'contact function returns nothing to non-admins');
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select contact_email from public.get_client_contacts('e1000000-0000-0000-0000-000000000001')), 'boss@acme.test',
          'admins can read client contacts');

-- ---------------------------------------------------------------------------
-- Daily reminders
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims to '';
-- I2: one carried-forward task, one overdue task, one completed overdue task (ignored).
insert into public.tasks (project_id, workspace_id, title, scheduled_date, due_date, created_by, status) values
  ((select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
   'e1000000-0000-0000-0000-000000000001', 'Old work', '2026-10-10', null, 'b2222222-2222-2222-2222-222222222222', 'TODO'),
  ((select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
   'e1000000-0000-0000-0000-000000000001', 'Late work', '2026-10-12', '2026-10-11', 'b2222222-2222-2222-2222-222222222222', 'TODO'),
  ((select id from public.projects where workspace_id = 'e1000000-0000-0000-0000-000000000001' and is_default),
   'e1000000-0000-0000-0000-000000000001', 'Done work', '2026-10-01', '2026-10-02', 'b2222222-2222-2222-2222-222222222222', 'COMPLETED');
insert into public.task_assignees (task_id, user_id, assigned_by)
select t.id, 'b4444444-4444-4444-4444-444444444444', 'b2222222-2222-2222-2222-222222222222'
from public.tasks t where t.title in ('Old work', 'Late work', 'Done work')
on conflict do nothing;
-- Clear the reassignment-era tasks from I2 so the digest counts are deterministic.
delete from public.task_assignees ta using public.tasks t
where ta.task_id = t.id and t.title = 'Admin task' and ta.user_id = 'b4444444-4444-4444-4444-444444444444';

select is(private.send_daily_reminders('2026-10-12 02:00:00+00'), 0,
          'no reminders outside 09:00–09:29 local time (07:30 IST)');
select ok(private.send_daily_reminders('2026-10-12 03:30:00+00') >= 1, 'reminders sent at 09:00 IST');
select is((select message from public.notifications where user_id = 'b4444444-4444-4444-4444-444444444444' and reminder_date = '2026-10-12'),
          '0 due today · 1 carried forward · 1 overdue', 'digest counts exclude completed work');
select is(private.send_daily_reminders('2026-10-12 03:45:00+00'), 0, 'a second run the same day creates no duplicates');
select is((select count(*)::int from public.notifications where user_id = 'b4444444-4444-4444-4444-444444444444' and reminder_date = '2026-10-12'), 1,
          'exactly one digest per recipient per day');
set local role authenticated;
set local request.jwt.claims to '{"sub":"b3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.notifications where user_id = 'b4444444-4444-4444-4444-444444444444'), 0,
          'recipients cannot read other people''s reminders');
reset role;
select ok(not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
          or exists (select 1 from cron.job where jobname = 'daily-task-reminders'),
          'reminder job is scheduled when pg_cron is available');

select * from finish();
rollback;
