-- Migration 007: morning/evening reports, meeting kinds/times, bug reports.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1111111-1111-1111-1111-111111111111', 'sa@rb.test', '{"full_name":"SA"}'),
  ('c2222222-2222-2222-2222-222222222222', 'ad@rb.test', '{"full_name":"AD"}'),
  ('c3333333-3333-3333-3333-333333333333', 'iv@rb.test', '{"full_name":"IV"}'),
  ('c4444444-4444-4444-4444-444444444444', 'i2@rb.test', '{"full_name":"I2"}'),
  ('c5555555-5555-5555-5555-555555555555', 'ot@rb.test', '{"full_name":"OT"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('c1111111-1111-1111-1111-111111111111', 'c5555555-5555-5555-5555-555555555555');
update public.profiles set role = 'ADMIN' where id = 'c2222222-2222-2222-2222-222222222222';

insert into public.workspaces (id, name, created_by) values
  ('d1000000-0000-0000-0000-000000000001', 'RB', 'c1111111-1111-1111-1111-111111111111'),
  ('d2000000-0000-0000-0000-000000000002', 'Other', 'c5555555-5555-5555-5555-555555555555');
insert into public.workspace_members (workspace_id, user_id) values
  ('d1000000-0000-0000-0000-000000000001', 'c2222222-2222-2222-2222-222222222222'),
  ('d1000000-0000-0000-0000-000000000001', 'c3333333-3333-3333-3333-333333333333'),
  ('d1000000-0000-0000-0000-000000000001', 'c4444444-4444-4444-4444-444444444444');

-- ---------------------------------------------------------------------------
-- Bug reports
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$
  insert into public.bug_reports (workspace_id, reported_by, title, description, page)
  values ('d1000000-0000-0000-0000-000000000001', 'c3333333-3333-3333-3333-333333333333', 'Button broken', 'Nothing happens', '/my-day')
$$, 'member submits a bug report');
select throws_ok($$
  insert into public.bug_reports (workspace_id, reported_by, title, description)
  values ('d1000000-0000-0000-0000-000000000001', 'c4444444-4444-4444-4444-444444444444', 'Forged', 'x')
$$, '42501', null, 'cannot report as someone else');
select throws_ok($$
  insert into public.bug_reports (workspace_id, reported_by, title, description, status)
  values ('d1000000-0000-0000-0000-000000000001', 'c3333333-3333-3333-3333-333333333333', 'Pre-resolved', 'x', 'RESOLVED')
$$, '42501', null, 'new reports must start OPEN');
select throws_ok($$
  insert into public.bug_reports (workspace_id, reported_by, title, description)
  values ('d2000000-0000-0000-0000-000000000002', 'c3333333-3333-3333-3333-333333333333', 'Wrong ws', 'x')
$$, '42501', null, 'cannot report into a workspace you are not in');
select throws_ok($$
  update public.bug_reports set title = 'edited' where title = 'Button broken'
$$, '42501', null, 'reporters cannot edit reports (only status is updatable, by admins)');
update public.bug_reports set status = 'RESOLVED' where title = 'Button broken';

set local request.jwt.claims to '{"sub":"c4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.bug_reports), 0, 'other members cannot see someone else''s report');
set local request.jwt.claims to '{"sub":"c5555555-5555-5555-5555-555555555555","role":"authenticated"}';
select is((select count(*)::int from public.bug_reports), 0, 'super admin of another workspace cannot see it');
set local request.jwt.claims to '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select status from public.bug_reports where title = 'Button broken'), 'OPEN', 'reporter cannot change status');
set local request.jwt.claims to '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.bug_reports), 1, 'workspace admin can review reports');
update public.bug_reports set status = 'IN_PROGRESS' where title = 'Button broken';
select is((select status from public.bug_reports where title = 'Button broken'), 'IN_PROGRESS', 'admin can update status');
select throws_ok($$
  update public.bug_reports set status = 'WONTFIX' where title = 'Button broken'
$$, '23514', null, 'status must be a known value');

-- ---------------------------------------------------------------------------
-- Morning plan / evening report on the existing daily_reports row
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$
  select public.submit_morning_plan('d1000000-0000-0000-0000-000000000001', 'Finish homepage')
$$, 'employee submits a morning plan');
select lives_ok($$
  select public.submit_evening_report('d1000000-0000-0000-0000-000000000001', 0, 'Homepage done')
$$, 'same row is completed with the evening report');
select is((select count(*)::int from public.daily_reports where user_id = 'c3333333-3333-3333-3333-333333333333'), 1,
          'morning plan and evening report share one row');
set local request.jwt.claims to '{"sub":"c4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select lives_ok($$
  select public.submit_morning_plan('d1000000-0000-0000-0000-000000000001', 'tampered')
$$, 'a colleague''s submission only writes the colleague''s own report');
select is((select count(*)::int from public.daily_reports where user_id = 'c3333333-3333-3333-3333-333333333333'), 0,
          'colleagues cannot read another employee''s report');
reset role;
select is((select morning_plan from public.daily_reports where user_id = 'c3333333-3333-3333-3333-333333333333'), 'Finish homepage',
          'colleagues cannot modify another employee''s report');

-- ---------------------------------------------------------------------------
-- Meeting links: kind and time
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok($$
  insert into public.meeting_links (workspace_id, title, url, kind, starts_at, created_by)
  values ('d1000000-0000-0000-0000-000000000001', 'Morning standup', 'https://meet.example.com/am', 'MORNING', '09:30', 'c1111111-1111-1111-1111-111111111111')
$$, 'super admin adds a morning meeting with a time');
select throws_ok($$
  insert into public.meeting_links (workspace_id, title, url, kind, created_by)
  values ('d1000000-0000-0000-0000-000000000001', 'Bad', 'https://meet.example.com/x', 'LUNCH', 'c1111111-1111-1111-1111-111111111111')
$$, '23514', null, 'meeting kind must be MORNING, EVENING or OTHER');
set local request.jwt.claims to '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.meeting_links set starts_at = '23:00' where title = 'Morning standup' and workspace_id = 'd1000000-0000-0000-0000-000000000001';
reset role;
select is((select starts_at::text from public.meeting_links where title = 'Morning standup' and workspace_id = 'd1000000-0000-0000-0000-000000000001'), '09:30:00',
          'admins still cannot change meeting links');

select * from finish();
rollback;
