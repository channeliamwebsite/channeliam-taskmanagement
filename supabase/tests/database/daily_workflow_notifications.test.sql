-- Migration 039: leave notifications, morning plan refresh, evening reminders.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres): sa, sa2 (super admins), ad (admin), iv (individual), off (deactivated); workspace W (UTC+5:30)
insert into auth.users (id, email, raw_user_meta_data) values
  ('b7000000-0000-4000-8000-000000000001', 'sa@dw.test', '{"full_name":"Sam"}'),
  ('b7000000-0000-4000-8000-000000000002', 'sa2@dw.test', '{"full_name":"Sia"}'),
  ('b7000000-0000-4000-8000-000000000003', 'ad@dw.test', '{"full_name":"Ade"}'),
  ('b7000000-0000-4000-8000-000000000004', 'iv@dw.test', '{"full_name":"Ivy"}'),
  ('b7000000-0000-4000-8000-000000000005', 'off@dw.test', '{"full_name":"Off"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('b7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002');
update public.profiles set role = 'ADMIN' where id = 'b7000000-0000-4000-8000-000000000003';
update public.profiles set is_active = false where id = 'b7000000-0000-4000-8000-000000000005';
insert into public.workspaces (id, name, created_by, timezone) values
  ('b8000000-0000-4000-8000-000000000001', 'DW', 'b7000000-0000-4000-8000-000000000001', 'Asia/Kolkata');
insert into public.workspace_members (workspace_id, user_id) values
  ('b8000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000001'),
  ('b8000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000003'),
  ('b8000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000004'),
  ('b8000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000005');
insert into public.projects (id, workspace_id, name, created_by) values
  ('ba000000-0000-4000-8000-000000000001', 'b8000000-0000-4000-8000-000000000001', 'P', 'b7000000-0000-4000-8000-000000000003');

-- B. Leave notifications -------------------------------------------------------
insert into public.hr_leave_applications (id, user_id, leave_type, start_date, end_date, working_days, reason)
values ('bc000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000004', 'WFH', '2026-12-01', '2026-12-02', 2, 'Plumber visit');
select is((select count(*)::int from public.notifications where type = 'LEAVE_SUBMITTED'),
  (select count(*)::int from public.profiles where role = 'SUPER_ADMIN' and is_active), 'every active super admin is told about the application');
select is((select count(*)::int from public.notifications where type = 'LEAVE_SUBMITTED'
  and user_id in ('b7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000002')), 2, 'including both test super admins');
select ok((select bool_and(message like 'Ivy applied for work from home (01 Dec – 02 Dec 2026, 2 working days).') from public.notifications where type = 'LEAVE_SUBMITTED'),
  'the message names the employee, the leave and the dates');
select is((select count(*)::int from public.notifications where user_id = 'b7000000-0000-4000-8000-000000000004'), 0, 'the applicant gets nothing yet');

update public.hr_leave_applications set status = 'APPROVED', decided_by = 'b7000000-0000-4000-8000-000000000001', decided_at = now()
where id = 'bc000000-0000-4000-8000-000000000001';
select results_eq(
  $$ select type::text, title from public.notifications where user_id = 'b7000000-0000-4000-8000-000000000004' $$,
  $$ values ('LEAVE_DECIDED', 'Leave approved') $$, 'the employee is told it was approved');
update public.hr_leave_applications set reason = 'Plumber visit (updated)' where id = 'bc000000-0000-4000-8000-000000000001';
update public.hr_leave_applications set status = 'APPROVED' where id = 'bc000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.notifications where user_id = 'b7000000-0000-4000-8000-000000000004'), 1, 'other updates send nothing more');

insert into public.hr_leave_applications (id, user_id, leave_type, start_date, end_date, working_days, reason)
values ('bc000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000003', 'WFH', '2026-12-03', '2026-12-03', 1, 'Travel');
update public.hr_leave_applications set status = 'REJECTED', rejection_reason = 'Team offsite', decided_by = 'b7000000-0000-4000-8000-000000000001', decided_at = now()
where id = 'bc000000-0000-4000-8000-000000000002';
select results_eq(
  $$ select title, message from public.notifications where user_id = 'b7000000-0000-4000-8000-000000000003' $$,
  $$ values ('Leave rejected', 'Your work from home for 03 Dec 2026 was rejected: Team offsite') $$, 'a rejection includes the reason');
select throws_ok($$ insert into public.notifications (user_id, type, title, dedupe_key)
  values ('b7000000-0000-4000-8000-000000000003', 'LEAVE_DECIDED', 'x', 'leave-decided:bc000000-0000-4000-8000-000000000002') $$,
  '23505', null, 'the dedupe key blocks a second copy');

-- C. Morning plan refresh -------------------------------------------------------
insert into public.tasks (id, project_id, title, created_by) values
  ('bb000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'Planned', 'b7000000-0000-4000-8000-000000000003'),
  ('bb000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000001', 'Assigned later', 'b7000000-0000-4000-8000-000000000003'),
  ('bb000000-0000-4000-8000-000000000003', 'ba000000-0000-4000-8000-000000000001', 'Already done', 'b7000000-0000-4000-8000-000000000003');
update public.tasks set status = 'COMPLETED' where id = 'bb000000-0000-4000-8000-000000000003';
insert into public.task_assignees (task_id, user_id, is_primary) values ('bb000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-000000000004', true);
set local role authenticated;
set local request.jwt.claims to '{"sub":"b7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select public.submit_morning_plan('b8000000-0000-4000-8000-000000000001', 'Focus: Planned first', array['bb000000-0000-4000-8000-000000000001']::uuid[]);
reset role;
insert into public.task_assignees (task_id, user_id, is_primary) values
  ('bb000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000004', true),
  ('bb000000-0000-4000-8000-000000000003', 'b7000000-0000-4000-8000-000000000004', true);
select results_eq(
  $$ select planned_task_ids, morning_plan from public.daily_reports where user_id = 'b7000000-0000-4000-8000-000000000004' $$,
  $$ values (array['bb000000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002']::uuid[], 'Focus: Planned first') $$,
  'a task assigned later is appended once; completed tasks and the employee''s notes are untouched');
insert into public.task_assignees (task_id, user_id) values ('bb000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000003');
select is((select cardinality(planned_task_ids) from public.daily_reports where user_id = 'b7000000-0000-4000-8000-000000000004'), 2,
  'adding another assignee to the task does not touch Ivy''s plan again');
select is((select count(*)::int from public.daily_reports where user_id = 'b7000000-0000-4000-8000-000000000003'), 0,
  'and creates no plan for someone who has not submitted one');

-- D. Evening reminders ------------------------------------------------------------
-- Other local workspaces may have members too, so count this workspace's reminders only.
create function pg_temp.dw_reminders(p_day date) returns int language sql as $f$
  select count(*)::int from public.notifications
  where type = 'REPORT_REMINDER' and dedupe_key = 'evening-report:b8000000-0000-4000-8000-000000000001:' || p_day
$f$;
-- 19:00 on a Wednesday in India: the admin and the individual are reminded once.
select private.send_evening_report_reminders('2026-12-02 19:00+05:30');
select is(pg_temp.dw_reminders('2026-12-02'), 2, 'admin and individual are reminded (not super admins, not the deactivated)');
select private.send_evening_report_reminders('2026-12-02 19:30+05:30');
select is(pg_temp.dw_reminders('2026-12-02'), 2, 'a later run sends nothing new');
select private.send_evening_report_reminders('2026-12-03 17:00+05:30');
select is(pg_temp.dw_reminders('2026-12-03'), 0, 'nothing before 18:30');
-- An approved non-WFH leave suppresses the reminder (WFH days still need a report).
update public.hr_leave_applications set leave_type = 'LWP' where id = 'bc000000-0000-4000-8000-000000000001';
select private.send_evening_report_reminders('2026-12-01 19:00+05:30');
select is(pg_temp.dw_reminders('2026-12-01'), 1, 'someone on approved leave is not reminded');
-- Sunday (weekly off) and a public holiday: none.
select private.send_evening_report_reminders('2026-12-06 19:00+05:30');
select is(pg_temp.dw_reminders('2026-12-06'), 0, 'no reminders on the weekly off day');
insert into public.hr_public_holidays (name, holiday_date) values ('Test holiday', '2026-12-08');
select private.send_evening_report_reminders('2026-12-08 19:00+05:30');
select is(pg_temp.dw_reminders('2026-12-08'), 0, 'no reminders on a public holiday');
-- Today: the admin submits the evening report, then the job runs: only the individual is reminded.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.submit_evening_report('b8000000-0000-4000-8000-000000000001', 0, 'Done');
reset role;
select private.send_evening_report_reminders(now(), true);
select results_eq(
  $$ select user_id from public.notifications where type = 'REPORT_REMINDER'
     and dedupe_key = 'evening-report:b8000000-0000-4000-8000-000000000001:' || (now() at time zone 'Asia/Kolkata')::date $$,
  $$ values ('b7000000-0000-4000-8000-000000000004'::uuid) $$,
  'someone who already submitted today is not reminded');

-- Job monitoring knows the new job.
set local role authenticated;
set local request.jwt.claims to '{"sub":"b7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(exists (select 1 from public.scheduled_job_health() where job_name = 'evening-report-reminders'), 'the reminder job is monitored');
select lives_ok($$ select public.retry_scheduled_job('evening-report-reminders') $$, 'and can be re-run by a super admin');

select * from finish();
rollback;
