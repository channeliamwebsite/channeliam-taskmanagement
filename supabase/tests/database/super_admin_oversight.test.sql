-- Migrations 012 (super admins do not submit daily reports) and 013 (meeting
-- records). Valid after 013. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). W: sa (creator, super admin), adm, ind. W2: sa (also
-- a member) and s2 (super admin of W2 only). out: member of no workspace.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8e000000-0000-4000-8000-000000000001', 'sa@so.test', '{"full_name":"SA"}'),
  ('8e000000-0000-4000-8000-000000000002', 'adm@so.test', '{"full_name":"ADM"}'),
  ('8e000000-0000-4000-8000-000000000003', 'ind@so.test', '{"full_name":"IND"}'),
  ('8e000000-0000-4000-8000-000000000004', 's2@so.test', '{"full_name":"S2"}'),
  ('8e000000-0000-4000-8000-000000000005', 'out@so.test', '{"full_name":"OUT"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('8e000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000004');
update public.profiles set role = 'ADMIN' where id = '8e000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by, timezone) values
  ('9e000000-0000-4000-8000-000000000001', 'SO', '8e000000-0000-4000-8000-000000000001', 'Asia/Kolkata'),
  ('9e000000-0000-4000-8000-000000000002', 'SO two', '8e000000-0000-4000-8000-000000000004', 'Asia/Kolkata');
insert into public.workspace_members (workspace_id, user_id) values
  ('9e000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000002'),
  ('9e000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000003'),
  ('9e000000-0000-4000-8000-000000000002', '8e000000-0000-4000-8000-000000000001');
-- A report the super admin submitted before migration 012 (history).
insert into public.daily_reports (user_id, workspace_id, report_date, morning_plan, morning_submitted_at)
values ('8e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', '2026-10-01', 'Old plan', '2026-10-01 04:00+00');
insert into public.meeting_links (id, workspace_id, title, url, kind, starts_at, created_by) values
  ('5e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'Morning planning', 'https://meet.example.com/am', 'MORNING', '09:30', '8e000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- 012: report submission
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.submit_morning_plan('9e000000-0000-4000-8000-000000000001', 'x') $$, '42501',
  'Super admins review daily reports; they do not submit them', 'a super admin cannot submit a morning plan through the API');
select throws_ok($$ select public.submit_evening_report('9e000000-0000-4000-8000-000000000001', 1, 'x') $$, '42501',
  'Super admins review daily reports; they do not submit them', 'a super admin cannot submit an evening report through the API');
select is((select count(*)::int from public.daily_reports where user_id = '8e000000-0000-4000-8000-000000000001' and report_date = '2026-10-01' and morning_plan = 'Old plan'), 1,
  'the super admin''s earlier report is kept and readable');
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.submit_morning_plan('9e000000-0000-4000-8000-000000000001', 'Admin plan') $$, 'an admin still submits a morning plan');
select lives_ok($$ select public.submit_evening_report('9e000000-0000-4000-8000-000000000001', 2, 'Admin done') $$, 'an admin still submits an evening report');
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$ select public.submit_morning_plan('9e000000-0000-4000-8000-000000000001', 'My plan') $$, 'an individual still submits a morning plan');
select lives_ok($$ select public.submit_evening_report('9e000000-0000-4000-8000-000000000001', 3, 'Done') $$, 'an individual still submits an evening report');
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select public.submit_morning_plan('9e000000-0000-4000-8000-000000000001', 'x') $$, '42501',
  'Reports can only be submitted by active members of the workspace', 'non-members are still rejected by the membership check');
reset role;
set local request.jwt.claims to '';

-- Automatic morning snapshots still cover every active member, super admin included,
-- and a snapshot is never a submission.
select ok(private.generate_morning_reports(now(), true, '9e000000-0000-4000-8000-000000000001') >= 1, 'the morning job still runs');
select is(
  (select format('%s|%s', morning_snapshot is not null, morning_submitted_at is null)
   from public.daily_reports
   where user_id = '8e000000-0000-4000-8000-000000000001' and workspace_id = '9e000000-0000-4000-8000-000000000001'
     and report_date = (now() at time zone 'Asia/Kolkata')::date),
  't|t', 'the super admin gets an automatic snapshot that is not a submitted morning plan');

-- ---------------------------------------------------------------------------
-- 013: meeting records (super admins of the workspace only)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$
  insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date, status, agenda, notes, decisions)
  values ('9e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', '2026-10-27', 'HELD', 'Plan', 'Discussed', 'Ship A')
$$, 'a super admin records a meeting');
select throws_ok($$
  insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date)
  values ('9e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', '2026-10-27')
$$, '23505', null, 'one record per meeting and date');
select throws_ok($$
  insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date, status)
  values ('9e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', '2026-10-28', 'DONE')
$$, '23514', null, 'only known statuses are accepted');
select throws_ok($$
  insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date)
  values ('9e000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000001', '2026-10-29')
$$, '42501', null, 'a record must belong to the meeting''s workspace');
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.meeting_records), 0, 'admins cannot read meeting records');
select throws_ok($$
  insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date)
  values ('9e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', '2026-10-30')
$$, '42501', null, 'admins cannot create meeting records');
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.meeting_records), 0, 'individuals cannot read meeting records');
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.meeting_records), 0, 'a super admin of another workspace cannot read them');
update public.meeting_records set notes = 'tampered' where meeting_link_id = '5e000000-0000-4000-8000-000000000001';
reset role;
set local request.jwt.claims to '';
select is((select notes from public.meeting_records where meeting_date = '2026-10-27'), 'Discussed',
  'a super admin of another workspace cannot change them');
delete from public.meeting_links where id = '5e000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.meeting_records), 0, 'deleting a meeting removes its records');

select * from finish();
rollback;
