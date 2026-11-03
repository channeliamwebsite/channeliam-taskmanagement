-- Migration 031: deleting a meeting can no longer destroy meeting records
-- (super admin notes). Regression test for the release-audit defect: an admin
-- deleting a meeting they created cascaded to records they cannot see.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres). W: ad (admin, organiser), iv (participant).
-- sa = super admin (member of nothing).
insert into auth.users (id, email, raw_user_meta_data) values
  ('ae000000-0000-4000-8000-000000000001', 'sa@mr.test', '{"full_name":"SA"}'),
  ('ae000000-0000-4000-8000-000000000002', 'ad@mr.test', '{"full_name":"AD"}'),
  ('ae000000-0000-4000-8000-000000000003', 'iv@mr.test', '{"full_name":"IV"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'ae000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id = 'ae000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name) values ('af000000-0000-4000-8000-000000000001', 'MR');
insert into public.workspace_members (workspace_id, user_id) values
  ('af000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000002'),
  ('af000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000003');
-- Two meetings the admin organised: one with super admin notes, one without.
insert into public.meeting_links (id, workspace_id, title, url, created_by) values
  ('b0000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001', 'With notes', 'https://meet.example.com/a', 'ae000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000002', 'af000000-0000-4000-8000-000000000001', 'No notes', 'https://meet.example.com/b', 'ae000000-0000-4000-8000-000000000002');
insert into public.meeting_participants (meeting_link_id, user_id, added_by) values
  ('b0000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000003', 'ae000000-0000-4000-8000-000000000002');
insert into public.meeting_records (id, workspace_id, meeting_link_id, meeting_date, notes, decisions) values
  ('b1000000-0000-4000-8000-000000000001', 'af000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', '2026-10-30', 'SA notes', 'Ship on Friday');

set local role authenticated;

-- The admin who organised the meeting
set local request.jwt.claims to '{"sub":"ae000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.meeting_records), 0, 'the admin cannot see the super admin''s meeting records');
select throws_ok($$ delete from public.meeting_links where id = 'b0000000-0000-4000-8000-000000000001' $$,
  '55000', 'This meeting has meeting records (notes or decisions). Deactivate it instead of deleting it.',
  'the admin cannot delete a meeting that has records, even though they cannot see them');
select lives_ok($$ update public.meeting_links set is_active = false where id = 'b0000000-0000-4000-8000-000000000001' $$,
  'the admin deactivates it instead');
select results_eq($$ delete from public.meeting_links where id = 'b0000000-0000-4000-8000-000000000002' returning title $$,
  $$ values ('No notes'::text) $$, 'the admin still deletes their own meeting without records');
select lives_ok($$
  insert into public.meeting_links (workspace_id, title, url, created_by)
  values ('af000000-0000-4000-8000-000000000001', 'New one', 'https://meet.example.com/c', 'ae000000-0000-4000-8000-000000000002')
$$, 'and still schedules meetings');

-- The super admin
set local request.jwt.claims to '{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ delete from public.meeting_links where id = 'b0000000-0000-4000-8000-000000000001' $$,
  '55000', null, 'a super admin cannot delete a meeting with records either');
select is((select format('%s|%s', notes, decisions) from public.meeting_records where id = 'b1000000-0000-4000-8000-000000000001'),
  'SA notes|Ship on Friday', 'the notes and decisions survived every refused deletion');
select is((select count(*)::int from public.meeting_participants where meeting_link_id = 'b0000000-0000-4000-8000-000000000001'), 1,
  'and so did the participant list');
select results_eq($$ delete from public.meeting_records where id = 'b1000000-0000-4000-8000-000000000001' returning notes $$,
  $$ values ('SA notes'::text) $$, 'a super admin can still remove a record explicitly (013 unchanged)');
select results_eq($$ delete from public.meeting_links where id = 'b0000000-0000-4000-8000-000000000001' returning title $$,
  $$ values ('With notes'::text) $$, 'after which the meeting has no records and can be deleted');

reset role;
set local request.jwt.claims to '';

-- Trusted maintenance without a signed-in user and whole-workspace removal are not blocked.
insert into public.meeting_links (id, workspace_id, title, url) values
  ('b0000000-0000-4000-8000-000000000003', 'af000000-0000-4000-8000-000000000001', 'Maintenance', 'https://meet.example.com/d');
insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date, notes) values
  ('af000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', '2026-10-30', 'kept until maintenance');
select lives_ok($$ delete from public.meeting_links where id = 'b0000000-0000-4000-8000-000000000003' $$,
  'deletion without a signed-in user (service role / SQL editor) is trusted, as in 027');
insert into public.meeting_links (id, workspace_id, title, url) values
  ('b0000000-0000-4000-8000-000000000004', 'af000000-0000-4000-8000-000000000001', 'Last', 'https://meet.example.com/e');
insert into public.meeting_records (workspace_id, meeting_link_id, meeting_date, notes) values
  ('af000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004', '2026-10-30', 'goes with the workspace');
select lives_ok($$ delete from public.workspaces where id = 'af000000-0000-4000-8000-000000000001' $$,
  'removing a whole workspace still works');

select * from finish();
rollback;
