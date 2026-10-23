-- Migration 011: tracking rules, timezones, late and overlapping runs, and
-- report timestamps. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
--   X (Asia/Kolkata): sa (creator, super admin) and x1
--   Y (America/New_York): y1 only     K (Asia/Kathmandu, +05:45): k1 only
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8b000000-0000-4000-8000-000000000001', 'sa@rt.test', '{"full_name":"SA"}'),
  ('8b000000-0000-4000-8000-000000000002', 'x1@rt.test', '{"full_name":"X1"}'),
  ('8b000000-0000-4000-8000-000000000003', 'y1@rt.test', '{"full_name":"Y1"}'),
  ('8b000000-0000-4000-8000-000000000004', 'k1@rt.test', '{"full_name":"K1"}');
update public.profiles set role = 'SUPER_ADMIN' where id = '8b000000-0000-4000-8000-000000000001';

insert into public.workspaces (id, name, created_by, timezone) values
  ('9c000000-0000-4000-8000-000000000001', 'RT X', '8b000000-0000-4000-8000-000000000001', 'Asia/Kolkata'),
  ('9c000000-0000-4000-8000-000000000002', 'RT Y', '8b000000-0000-4000-8000-000000000003', 'America/New_York'),
  ('9c000000-0000-4000-8000-000000000003', 'RT K', '8b000000-0000-4000-8000-000000000004', 'Asia/Kathmandu');
insert into public.workspace_members (workspace_id, user_id) values
  ('9c000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000002');

-- ---------------------------------------------------------------------------
-- Timezones: 09:00 local, Monday-Saturday, across daylight-saving changes
-- ---------------------------------------------------------------------------
-- New York, before the March change (EST, UTC-5)
select is(private.generate_morning_reports('2026-03-06 13:30:00+00', false, '9c000000-0000-4000-8000-000000000002'), 0,
  'New York (EST): nothing at 08:30 local');
select is(private.generate_morning_reports('2026-03-06 14:00:00+00', false, '9c000000-0000-4000-8000-000000000002'), 1,
  'New York (EST): generated at 09:00 local');
select is((select report_date::text from public.daily_reports where workspace_id = '9c000000-0000-4000-8000-000000000002'),
  '2026-03-06', 'the report date is the local date');
select is(private.generate_morning_reports('2026-03-08 15:00:00+00', false, '9c000000-0000-4000-8000-000000000002'), 0,
  'New York: nothing on Sunday (the day clocks change)');
-- After the change (EDT, UTC-4): 13:00 UTC is 09:00 local (it would be 08:00 at UTC-5)
select is(private.generate_morning_reports('2026-03-09 12:45:00+00', false, '9c000000-0000-4000-8000-000000000002'), 0,
  'New York (EDT): nothing at 08:45 local');
select is(private.generate_morning_reports('2026-03-09 13:00:00+00', false, '9c000000-0000-4000-8000-000000000002'), 1,
  'New York (EDT): generated at 09:00 local after the clocks went forward');
-- 03:30 UTC on 10 March is still 9 March (23:30) in New York
select is(private.generate_morning_reports('2026-03-10 03:30:00+00', false, '9c000000-0000-4000-8000-000000000002'), 0,
  'New York: a run late in the local evening adds nothing');
select is((select count(*)::int from public.daily_reports
           where workspace_id = '9c000000-0000-4000-8000-000000000002' and report_date = '2026-03-10'), 0,
  'no report for the next UTC date');
-- November change back to EST: 13:30 UTC is 08:30 local (it would be 09:30 at UTC-4)
select is(private.generate_morning_reports('2026-11-02 13:30:00+00', false, '9c000000-0000-4000-8000-000000000002'), 0,
  'New York (EST again): nothing at 08:30 local after the clocks went back');
select is(private.generate_morning_reports('2026-11-02 14:00:00+00', false, '9c000000-0000-4000-8000-000000000002'), 1,
  'New York (EST again): generated at 09:00 local');
-- Kathmandu, UTC+05:45: the 15-minute schedule still lands on 09:00 local
select is(private.generate_morning_reports('2026-10-19 03:14:00+00', false, '9c000000-0000-4000-8000-000000000003'), 0,
  'Kathmandu: nothing at 08:59 local');
select is(private.generate_morning_reports('2026-10-19 03:15:00+00', false, '9c000000-0000-4000-8000-000000000003'), 1,
  'Kathmandu: generated at 09:00 local');

-- ---------------------------------------------------------------------------
-- Workspace X, today. x1's tasks before the (late) morning report:
--   P open, then completed before the report; Q open; S scheduled tomorrow.
-- ---------------------------------------------------------------------------
insert into public.tasks (id, project_id, title, status) values
  ('7d000000-0000-4000-8000-000000000001', (select id from public.projects where workspace_id = '9c000000-0000-4000-8000-000000000001' and is_default), 'P done early', 'TODO'),
  ('7d000000-0000-4000-8000-000000000002', (select id from public.projects where workspace_id = '9c000000-0000-4000-8000-000000000001' and is_default), 'Q open', 'TODO');
insert into public.tasks (id, project_id, title, status, scheduled_date) values
  ('7d000000-0000-4000-8000-000000000003', (select id from public.projects where workspace_id = '9c000000-0000-4000-8000-000000000001' and is_default),
   'S moved in', 'TODO', (now() at time zone 'Asia/Kolkata')::date + 1);
insert into public.task_assignees (task_id, user_id) values
  ('7d000000-0000-4000-8000-000000000001', '8b000000-0000-4000-8000-000000000002'),
  ('7d000000-0000-4000-8000-000000000002', '8b000000-0000-4000-8000-000000000002'),
  ('7d000000-0000-4000-8000-000000000003', '8b000000-0000-4000-8000-000000000002');
update public.tasks set status = 'COMPLETED' where id = '7d000000-0000-4000-8000-000000000001';

-- x1 writes morning notes; their submission and last edit were an hour ago.
set local role authenticated;
set local request.jwt.claims to '{"sub":"8b000000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.submit_morning_plan('9c000000-0000-4000-8000-000000000001', 'Early notes');
reset role;
set local request.jwt.claims to '';
alter table public.daily_reports disable trigger set_updated_at;
update public.daily_reports set morning_submitted_at = now() - interval '1 hour', updated_at = now() - interval '1 hour'
where user_id = '8b000000-0000-4000-8000-000000000002' and workspace_id = '9c000000-0000-4000-8000-000000000001';
alter table public.daily_reports enable trigger set_updated_at;

-- Late run: the scheduler missed the morning and runs at 23:00 local (or just
-- after now, if that is later). Forced only on Sundays, when nothing is due.
create temp table late as
  select greatest(((now() at time zone 'Asia/Kolkata')::date + time '23:00') at time zone 'Asia/Kolkata',
                  now() + interval '1 second') as at,
         extract(isodow from (now() at time zone 'Asia/Kolkata')::date) = 7 as sunday;
select is(private.generate_morning_reports((select at from late), (select sunday from late), '9c000000-0000-4000-8000-000000000001'), 2,
  'a late run still writes one morning report per active member (sa, x1)');
select is(private.generate_morning_reports((select at from late) + interval '15 minutes', (select sunday from late), '9c000000-0000-4000-8000-000000000001'), 0,
  'the next late run writes nothing');
select ok(
  (select r.morning_generated_at = l.at and (r.morning_snapshot ->> 'generated_at')::timestamptz = l.at
   from public.daily_reports r, late l
   where r.user_id = '8b000000-0000-4000-8000-000000000002' and r.workspace_id = '9c000000-0000-4000-8000-000000000001'),
  'the report records when it was actually generated (not backdated to 09:00)');
select is(
  (select jsonb_path_query_array(morning_snapshot, '$.tasks[*].title') from public.daily_reports
   where user_id = '8b000000-0000-4000-8000-000000000002' and workspace_id = '9c000000-0000-4000-8000-000000000001'),
  '["Q open"]'::jsonb, 'the morning report lists open work only (not P, already completed; not S, tomorrow)');

-- Regression: generating the report is not an employee edit.
select is(
  (select format('%s|%s|%s', morning_plan, morning_submitted_at = now() - interval '1 hour', updated_at = now() - interval '1 hour')
   from public.daily_reports
   where user_id = '8b000000-0000-4000-8000-000000000002' and workspace_id = '9c000000-0000-4000-8000-000000000001'),
  'Early notes|t|t', 'the automatic report keeps the employee''s notes, submission time and last-edited time');

-- S is rescheduled into today after the report.
update public.tasks set scheduled_date = (now() at time zone 'Asia/Kolkata')::date where id = '7d000000-0000-4000-8000-000000000003';

set local role authenticated;
set local request.jwt.claims to '{"sub":"8b000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select string_agg(title || ':' || coalesce(status, '-') || ':' || tracking, ',' order by title)
   from public.daily_tracking('9c000000-0000-4000-8000-000000000001')
   where user_id = '8b000000-0000-4000-8000-000000000002'),
  'P done early:COMPLETED:COMPLETED_EARLY,Q open:TODO:MORNING,S moved in:TODO:MOVED_IN',
  'completed before the report is not "added"; an existing task moved into today is not "created"');

-- A real edit by the employee still updates the last-edited time.
set local request.jwt.claims to '{"sub":"8b000000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.submit_morning_plan('9c000000-0000-4000-8000-000000000001', 'Edited notes');
select is(
  (select format('%s|%s|%s', morning_plan, morning_submitted_at = now() - interval '1 hour', updated_at = now())
   from public.daily_reports
   where user_id = '8b000000-0000-4000-8000-000000000002' and workspace_id = '9c000000-0000-4000-8000-000000000001'),
  'Edited notes|t|t', 'an employee edit updates the last-edited time and keeps the first submission time');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Overlapping runs: each run holds the job's transaction-level advisory lock
-- until it commits, so a second run waits and then sees the first run's
-- snapshots. (Two real concurrent sessions: scripts/test-morning-report-race.mjs.)
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_locks
          where locktype = 'advisory' and pid = pg_backend_pid() and granted and objsubid = 1
            and ((classid::bigint << 32) | objid::bigint) = hashtext('private.generate_morning_reports')::bigint),
  'a run keeps the job lock until its transaction ends');

select * from finish();
rollback;
