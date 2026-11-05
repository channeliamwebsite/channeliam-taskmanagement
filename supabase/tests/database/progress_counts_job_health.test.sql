-- Migration 037: project_task_counts (same leaf rule as src/lib/progress.ts,
-- RLS applies) and the super-admin-only scheduled job health / retry.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres)
--   W1: ad (admin), iv (individual); project P1 with
--       T1 completed leaf, T2 open leaf (iv), T3 cancelled leaf,
--       T4 parent of S1 (completed) and S2 (cancelled), T5 parent of only a cancelled subtask
--   sa = super admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('e7000000-0000-4000-8000-000000000001', 'sa@pj.test', '{"full_name":"SA"}'),
  ('e7000000-0000-4000-8000-000000000002', 'ad@pj.test', '{"full_name":"AD"}'),
  ('e7000000-0000-4000-8000-000000000003', 'iv@pj.test', '{"full_name":"IV"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'e7000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id = 'e7000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by) values
  ('e8000000-0000-4000-8000-000000000001', 'PJ One', 'e7000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id) values
  ('e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002'),
  ('e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000003');
insert into public.projects (id, workspace_id, name, owner_id, created_by) values
  ('ea000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'P1',
   'e7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000002');
insert into public.tasks (id, project_id, title, status, created_by) values
  ('eb000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'T1', 'COMPLETED', 'e7000000-0000-4000-8000-000000000002'),
  ('eb000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000001', 'T2', 'IN_PROGRESS', 'e7000000-0000-4000-8000-000000000002'),
  ('eb000000-0000-4000-8000-000000000003', 'ea000000-0000-4000-8000-000000000001', 'T3', 'CANCELLED', 'e7000000-0000-4000-8000-000000000002'),
  ('eb000000-0000-4000-8000-000000000004', 'ea000000-0000-4000-8000-000000000001', 'T4', 'IN_PROGRESS', 'e7000000-0000-4000-8000-000000000002'),
  ('eb000000-0000-4000-8000-000000000005', 'ea000000-0000-4000-8000-000000000001', 'T5', 'TODO', 'e7000000-0000-4000-8000-000000000002');
insert into public.tasks (id, project_id, parent_task_id, title, status, created_by) values
  ('eb000000-0000-4000-8000-000000000011', 'ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000004', 'S1', 'COMPLETED', 'e7000000-0000-4000-8000-000000000002'),
  ('eb000000-0000-4000-8000-000000000012', 'ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000004', 'S2', 'CANCELLED', 'e7000000-0000-4000-8000-000000000002'),
  ('eb000000-0000-4000-8000-000000000013', 'ea000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000005', 'S3', 'CANCELLED', 'e7000000-0000-4000-8000-000000000002');
insert into public.task_assignees (task_id, user_id, is_primary) values
  ('eb000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000003', true);

set local role authenticated;

-- Leaf rule: T1, T2, S1 and T5 (its only subtask is cancelled) count; T3, S2, S3 are
-- cancelled; T4 is a parent. 4 total, 2 completed.
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select results_eq(
  $$ select total, completed from public.project_task_counts(array['ea000000-0000-4000-8000-000000000001']::uuid[]) $$,
  $$ values (4, 2) $$,
  'the admin gets leaf-task totals: parents and cancelled tasks are not counted'
);
select is_empty(
  $$ select * from public.project_task_counts(array['ea000000-0000-4000-8000-00000000ffff']::uuid[]) $$,
  'unknown projects return no row (the app shows 0 of 0)'
);

-- RLS applies (SECURITY INVOKER): the individual counts only the tasks they can see.
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select results_eq(
  $$ select total, completed from public.project_task_counts(array['ea000000-0000-4000-8000-000000000001']::uuid[]) $$,
  $$ select count(*)::integer, count(*) filter (where status = 'COMPLETED')::integer from public.tasks t
     where t.project_id = 'ea000000-0000-4000-8000-000000000001' and t.status <> 'CANCELLED'
       and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and c.status <> 'CANCELLED') $$,
  'an individual''s counts match the rows RLS lets them read'
);

-- Job health and retry: super admins only.
select throws_ok($$ select * from public.scheduled_job_health() $$, '42501', null, 'an individual cannot view job health');
select throws_ok($$ select public.retry_scheduled_job('daily-task-reminders') $$, '42501', null, 'an individual cannot run a job');
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select * from public.scheduled_job_health() $$, '42501', null, 'an admin cannot view job health');
select throws_ok($$ select public.retry_scheduled_job('daily-morning-reports') $$, '42501', null, 'an admin cannot run a job');

set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select * from public.scheduled_job_health() $$, 'a super admin can view job health');
select ok(
  (select count(*) from public.scheduled_job_health() where job_name in ('daily-morning-reports', 'daily-task-reminders')) = 2,
  'job health lists the reminder and morning-report jobs (pg_cron installed locally)'
);
select throws_ok($$ select public.retry_scheduled_job('anything-else') $$, '22023', null, 'only the app''s jobs can be run');

-- Retrying twice creates nothing the first run did not (idempotent, never forced).
select lives_ok($$ select public.retry_scheduled_job('daily-morning-reports') $$, 'a super admin can re-run the morning reports');
select lives_ok($$ select public.retry_scheduled_job('daily-task-reminders') $$, 'a super admin can re-run the reminders');
reset role;
create temporary table before_retry as
  select (select count(*) from public.daily_reports) as reports, (select count(*) from public.notifications) as notes;
set local role authenticated;
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.retry_scheduled_job('daily-morning-reports');
select public.retry_scheduled_job('daily-task-reminders');
reset role;
select is((select count(*) from public.daily_reports), (select reports from before_retry), 'a repeated morning-report run adds no reports');
select is((select count(*) from public.notifications), (select notes from before_retry), 'a repeated reminder run adds no notifications');

select * from finish();
rollback;
