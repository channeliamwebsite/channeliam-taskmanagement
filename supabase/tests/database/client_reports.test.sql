-- Migration 038: client reports (15/30-day periods, frozen team-level snapshots,
-- idempotent generation, failure + retry, review before delivery, access).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres)
--   W1: ad (admin), iv (individual, team "Design"); client C1 (project P1), client C2 (project P2)
--   W2: ad2 (admin, not in W1)        sa = super admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('d7000000-0000-4000-8000-000000000001', 'sa@cr.test', '{"full_name":"SA Person"}'),
  ('d7000000-0000-4000-8000-000000000002', 'ad@cr.test', '{"full_name":"Admin Person"}'),
  ('d7000000-0000-4000-8000-000000000003', 'iv@cr.test', '{"full_name":"Secret Name"}'),
  ('d7000000-0000-4000-8000-000000000004', 'ad2@cr.test', '{"full_name":"Other Admin"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'd7000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id in ('d7000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000004');
update public.profiles set team = 'Design' where id = 'd7000000-0000-4000-8000-000000000003';
insert into public.workspaces (id, name, created_by) values
  ('d8000000-0000-4000-8000-000000000001', 'CR One', 'd7000000-0000-4000-8000-000000000001'),
  ('d8000000-0000-4000-8000-000000000002', 'CR Two', 'd7000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id) values
  ('d8000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000002'),
  ('d8000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000003'),
  ('d8000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000004');
insert into public.clients (id, workspace_id, name, contact_name, notes) values
  ('d9000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 'Client One', 'Ravi', 'INTERNAL NOTE'),
  ('d9000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000001', 'Client Two', null, null);
insert into public.projects (id, workspace_id, name, client_id, created_by) values
  ('da000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 'Website', 'd9000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000002'),
  ('da000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000001', 'Other client work', 'd9000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000002');
-- Period 2026-09-01..2026-09-15 (15 days). Times are India time.
insert into public.tasks (id, project_id, title, status, priority, due_date, created_at, completed_at, created_by) values
  -- done in the period
  ('db000000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001', 'Home page', 'COMPLETED', 'HIGH', '2026-09-10', '2026-08-20 10:00+05:30', '2026-09-05 12:00+05:30', 'd7000000-0000-4000-8000-000000000002'),
  -- done before the period: excluded
  ('db000000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000001', 'Old work', 'COMPLETED', 'LOW', null, '2026-08-01 10:00+05:30', '2026-08-20 12:00+05:30', 'd7000000-0000-4000-8000-000000000002'),
  -- open and overdue at the cutoff
  ('db000000-0000-4000-8000-000000000003', 'da000000-0000-4000-8000-000000000001', 'Contact form', 'TODO', 'URGENT', '2026-09-12', '2026-09-02 10:00+05:30', null, 'd7000000-0000-4000-8000-000000000002'),
  -- in progress, due later
  ('db000000-0000-4000-8000-000000000004', 'da000000-0000-4000-8000-000000000001', 'Blog', 'IN_PROGRESS', 'MEDIUM', '2026-09-25', '2026-09-03 10:00+05:30', null, 'd7000000-0000-4000-8000-000000000002'),
  -- completed after the cutoff: still open (in progress) for this period
  ('db000000-0000-4000-8000-000000000005', 'da000000-0000-4000-8000-000000000001', 'Late finish', 'COMPLETED', 'MEDIUM', null, '2026-09-04 10:00+05:30', '2026-09-20 12:00+05:30', 'd7000000-0000-4000-8000-000000000002'),
  -- created after the cutoff: excluded
  ('db000000-0000-4000-8000-000000000006', 'da000000-0000-4000-8000-000000000001', 'Future', 'TODO', 'LOW', null, '2026-09-18 10:00+05:30', null, 'd7000000-0000-4000-8000-000000000002'),
  -- cancelled: excluded
  ('db000000-0000-4000-8000-000000000007', 'da000000-0000-4000-8000-000000000001', 'Dropped', 'CANCELLED', 'LOW', null, '2026-09-02 10:00+05:30', null, 'd7000000-0000-4000-8000-000000000002'),
  -- another client's task: never in Client One's report
  ('db000000-0000-4000-8000-000000000008', 'da000000-0000-4000-8000-000000000002', 'Other client secret', 'TODO', 'HIGH', null, '2026-09-02 10:00+05:30', null, 'd7000000-0000-4000-8000-000000000002');
-- The completion trigger stamps now(); set the historical completion times directly.
alter table public.tasks disable trigger track_task_completion;
update public.tasks set completed_at = '2026-09-05 12:00+05:30' where id = 'db000000-0000-4000-8000-000000000001';
update public.tasks set completed_at = '2026-08-20 12:00+05:30' where id = 'db000000-0000-4000-8000-000000000002';
update public.tasks set completed_at = '2026-09-20 12:00+05:30' where id = 'db000000-0000-4000-8000-000000000005';
alter table public.tasks enable trigger track_task_completion;
insert into public.task_assignees (task_id, user_id, is_primary) values
  ('db000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000003', true),
  ('db000000-0000-4000-8000-000000000003', 'd7000000-0000-4000-8000-000000000003', true);

set local role authenticated;

-- Access: individuals and admins of other workspaces cannot configure.
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.save_client_report_settings('d9000000-0000-4000-8000-000000000001', 15::smallint, 'BOTH', '2026-09-01', true) $$,
  '42501', null, 'an individual cannot configure client reports');
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select public.save_client_report_settings('d9000000-0000-4000-8000-000000000001', 15::smallint, 'BOTH', '2026-09-01', true) $$,
  '42501', null, 'an admin of another workspace cannot configure client reports');
select throws_ok($$ insert into public.client_reports (client_id, period_start, period_end, frequency_days) values ('d9000000-0000-4000-8000-000000000001', '2026-01-01', '2026-01-15', 15) $$,
  '42501', null, 'reports cannot be written directly');

-- The workspace admin configures 15 days and 30 days independently.
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.save_client_report_settings('d9000000-0000-4000-8000-000000000001', 15::smallint, 'BOTH', '2026-09-01', true, 'Client@Example.com') $$,
  'the workspace admin saves 15-day settings with a recipient');
select lives_ok($$ select public.save_client_report_settings('d9000000-0000-4000-8000-000000000002', 30::smallint, 'PDF', '2026-09-01', true) $$,
  'and 30-day settings for another client');
select throws_ok($$ select public.save_client_report_settings('d9000000-0000-4000-8000-000000000002', 20::smallint, 'PDF', '2026-09-01', true) $$,
  '23514', null, 'only 15 or 30 days are accepted');
select is((select recipient_email from public.client_report_settings where client_id = 'd9000000-0000-4000-8000-000000000001'), 'client@example.com', 'the recipient is stored lower-case');

reset role;
-- Scheduler on 2026-10-02: Client One gets 09-01..09-15 and 09-16..09-30; Client Two (30 days) gets 09-01..09-30.
select is(private.generate_client_reports('2026-10-02'), 3, 'three ended periods are generated');
select is(private.generate_client_reports('2026-10-02'), 0, 'a repeated run generates nothing');
select results_eq(
  $$ select period_start, period_end, status from public.client_reports where client_id = 'd9000000-0000-4000-8000-000000000001' order by period_start $$,
  $$ values ('2026-09-01'::date, '2026-09-15'::date, 'READY'), ('2026-09-16'::date, '2026-09-30'::date, 'READY') $$,
  'consecutive 15-day periods, all ready'
);
select is((select count(*)::int from public.client_reports where client_id = 'd9000000-0000-4000-8000-000000000002'), 1, 'the 30-day client has one period');

-- Snapshot contents for 09-01..09-15
create temporary table s1 as
  select snapshot as s from public.client_reports where client_id = 'd9000000-0000-4000-8000-000000000001' and period_start = '2026-09-01';
select is((select s -> 'totals' from s1),
  '{"total": 4, "completed": 1, "pending": 1, "in_progress": 2, "overdue": 1, "blocked": 0, "completion_percent": 25}'::jsonb,
  'totals use the cutoff: done-before, created-after, cancelled and other-client tasks are excluded');
select is((select s -> 'client' from s1), '{"name": "Client One", "contact_name": "Ravi"}'::jsonb, 'client details exclude internal notes');
select is((select s -> 'teams' from s1), '[{"team": "Design", "completed": 1, "open": 1}]'::jsonb, 'work summary is per team');
select ok((select s::text not like '%Secret Name%' and s::text not like '%iv@cr.test%' and s::text not like '%INTERNAL NOTE%' from s1),
  'no employee names, emails or internal notes in the snapshot');
select ok((select s::text not like '%Other client secret%' from s1), 'no other client''s tasks');
select is((select jsonb_array_length(s -> 'deliverables') from s1), 1, 'one completed deliverable');
select is((select s -> 'deliverables' -> 0 ->> 'title' from s1), 'Home page', 'the deliverable is the task completed in the period');
select is((select jsonb_array_length(s -> 'outstanding') from s1), 3, 'three outstanding items');
select is((select s -> 'projects' -> 0 ->> 'completion_percent' from s1), '25', 'project-wise progress');

-- Snapshots are history.
select throws_ok($$ update public.client_reports set snapshot = '{}' where client_id = 'd9000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'a ready snapshot cannot be changed');
select throws_ok($$ delete from public.client_reports where client_id = 'd9000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'reports cannot be deleted');

-- Failure is recorded and can be retried safely.
insert into public.client_reports (id, client_id, period_start, period_end, frequency_days, status, error, attempts)
values ('dc000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000002', '2026-08-01', '2026-08-30', 30, 'FAILED', 'simulated', 1);
set local role authenticated;
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select public.retry_client_report('dc000000-0000-4000-8000-000000000001') $$, '42501', null, 'another workspace''s admin cannot retry');
select is_empty($$ select id from public.client_reports $$, 'and cannot read the reports');
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is(public.retry_client_report('dc000000-0000-4000-8000-000000000001'), 'READY', 'the admin retries a failed report');
select is((select attempts from public.client_reports where id = 'dc000000-0000-4000-8000-000000000001'), 2, 'attempts are counted');
select is(public.retry_client_report('dc000000-0000-4000-8000-000000000001'), 'READY', 'retrying a ready report changes nothing');
select is((select attempts from public.client_reports where id = 'dc000000-0000-4000-8000-000000000001'), 2, 'a ready report is not rebuilt');

-- Delivery: authorised recipient and a reviewed report first.
select throws_ok($$ select public.set_client_report_delivery('d9000000-0000-4000-8000-000000000001', true, true) $$,
  '22023', null, 'automatic delivery needs a reviewed report');
select lives_ok($$ select public.review_client_report(
  (select id from public.client_reports where client_id = 'd9000000-0000-4000-8000-000000000001' and period_start = '2026-09-01'),
  'Launched the new home page.', 'Finish the contact form.', true) $$, 'the admin reviews a report with notes');
select throws_ok($$ select public.review_client_report(
  (select id from public.client_reports where client_id = 'd9000000-0000-4000-8000-000000000001' and period_start = '2026-09-01'), 'x', 'y', true) $$,
  '22023', null, 'a reviewed report is locked');
select lives_ok($$ select public.set_client_report_delivery('d9000000-0000-4000-8000-000000000001', true, true) $$, 'then delivery can be enabled');
select ok((select auto_delivery and recipient_authorized_at is not null from public.client_report_settings where client_id = 'd9000000-0000-4000-8000-000000000001'),
  'the recipient is authorised and delivery is on');
select lives_ok($$ select public.save_client_report_settings('d9000000-0000-4000-8000-000000000001', 15::smallint, 'BOTH', '2026-09-01', true, 'new@example.com') $$,
  'changing the recipient');
select ok((select not auto_delivery and recipient_authorized_at is null from public.client_report_settings where client_id = 'd9000000-0000-4000-8000-000000000001'),
  'withdraws the authorisation and stops delivery');
select throws_ok($$ select public.set_client_report_delivery('d9000000-0000-4000-8000-000000000002', true, false) $$,
  '22023', null, 'a client without a recipient cannot be authorised');

-- Frequency change continues after the last period; inactive settings generate nothing.
reset role;
update public.client_report_settings set frequency_days = 30 where client_id = 'd9000000-0000-4000-8000-000000000001';
select is(private.generate_client_reports('2026-10-31'), 2, 'each client gets its next 30-day period (Client One after switching from 15 days)');
select is((select max(period_end) from public.client_reports where client_id = 'd9000000-0000-4000-8000-000000000001'), '2026-10-30'::date, '10-01..10-30');
update public.client_report_settings set is_active = false;
select is(private.generate_client_reports('2027-06-01'), 0, 'inactive settings generate nothing');

-- Job monitoring knows the new job.
set local role authenticated;
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(exists (select 1 from public.scheduled_job_health() where job_name = 'client-reports'), 'client-reports is monitored');
select lives_ok($$ select public.retry_scheduled_job('client-reports') $$, 'and can be re-run by a super admin');

select * from finish();
rollback;
