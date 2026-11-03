-- Migration 029: meetings get a description, an end time and named
-- participants; admins schedule in their workspaces, super admins anywhere;
-- participants are notified in-app; visibility follows the participant list.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres). W1: ad, ad2 (admins), iv1, iv2. W2: out (admin).
-- sa = super admin, member of no workspace.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e7000000-0000-4000-8000-000000000001', 'sa@mp.test', '{"full_name":"SA"}'),
  ('e7000000-0000-4000-8000-000000000002', 'ad@mp.test', '{"full_name":"AD"}'),
  ('e7000000-0000-4000-8000-000000000003', 'ad2@mp.test', '{"full_name":"AD2"}'),
  ('e7000000-0000-4000-8000-000000000004', 'iv1@mp.test', '{"full_name":"IV1"}'),
  ('e7000000-0000-4000-8000-000000000005', 'iv2@mp.test', '{"full_name":"IV2"}'),
  ('e7000000-0000-4000-8000-000000000006', 'out@mp.test', '{"full_name":"OUT"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'e7000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN'
  where id in ('e7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-000000000006');
insert into public.workspaces (id, name, created_by) values
  ('e8000000-0000-4000-8000-000000000001', 'MP One', 'e7000000-0000-4000-8000-000000000001'),
  ('e8000000-0000-4000-8000-000000000002', 'MP Two', 'e7000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id) values
  ('e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002'),
  ('e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000003'),
  ('e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000004'),
  ('e8000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000005'),
  ('e8000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000006');
-- An organisation-wide meeting without named participants (as before 029).
insert into public.meeting_links (id, workspace_id, title, url) values
  ('e9000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001', 'Everyone stand-up', 'https://meet.example.com/all');

set local role authenticated;

-- Admin schedules in their own workspace
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$
  insert into public.meeting_links (id, workspace_id, title, description, url, kind, meeting_date, starts_at, ends_at, created_by)
  values ('e9000000-0000-4000-8000-000000000002', 'e8000000-0000-4000-8000-000000000001', 'Design review', 'Homepage drafts',
          'https://meet.example.com/design', 'OTHER', '2026-11-03', '15:00', '15:30', 'e7000000-0000-4000-8000-000000000002')
$$, 'an admin schedules a meeting with a description and an end time in their workspace');
select throws_ok($$
  insert into public.meeting_links (workspace_id, title, url, starts_at, ends_at, created_by)
  values ('e8000000-0000-4000-8000-000000000001', 'Backwards', 'https://meet.example.com/x', '15:00', '14:00', 'e7000000-0000-4000-8000-000000000002')
$$, '23514', null, 'the end time must be after the start time');
select throws_ok($$
  insert into public.meeting_links (workspace_id, title, url, created_by)
  values ('e8000000-0000-4000-8000-000000000002', 'Elsewhere', 'https://meet.example.com/y', 'e7000000-0000-4000-8000-000000000002')
$$, '42501', null, 'an admin cannot schedule in another workspace');
select lives_ok($$
  insert into public.meeting_participants (meeting_link_id, user_id, added_by) values
    ('e9000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000004', 'e7000000-0000-4000-8000-000000000002'),
    ('e9000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000002'),
    ('e9000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')
$$, 'the admin names participants, including a super admin who is not a member');
select throws_ok($$
  insert into public.meeting_participants (meeting_link_id, user_id, added_by)
  values ('e9000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000006', 'e7000000-0000-4000-8000-000000000002')
$$, '23514', null, 'someone from another workspace cannot be a participant');

-- Another admin of the same workspace: reads, but cannot change someone else's meeting
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.meeting_links where id = 'e9000000-0000-4000-8000-000000000002'), 1, 'another admin of the workspace sees it');
update public.meeting_links set title = 'Hijacked' where id = 'e9000000-0000-4000-8000-000000000002';
select throws_ok($$
  insert into public.meeting_participants (meeting_link_id, user_id, added_by)
  values ('e9000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000005', 'e7000000-0000-4000-8000-000000000003')
$$, '42501', null, 'another admin cannot add participants to it');

-- Individuals
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.meeting_links where id = 'e9000000-0000-4000-8000-000000000002'), 1, 'an invited individual sees the meeting');
select is((select count(*)::int from public.meeting_participants where meeting_link_id = 'e9000000-0000-4000-8000-000000000002'), 3,
  'and who else is invited');
select is((select format('%s|%s', type, message) from public.notifications
           where user_id = 'e7000000-0000-4000-8000-000000000004' and meeting_link_id = 'e9000000-0000-4000-8000-000000000002'),
  'MEETING_SCHEDULED|Tue, 03 Nov 2026 · 15:00–15:30', 'the invited individual gets one in-app invitation with the date and time');
select throws_ok($$
  insert into public.meeting_links (workspace_id, title, url, created_by)
  values ('e8000000-0000-4000-8000-000000000001', 'IV meeting', 'https://meet.example.com/iv', 'e7000000-0000-4000-8000-000000000004')
$$, '42501', null, 'individuals cannot schedule meetings');
select throws_ok($$
  insert into public.meeting_participants (meeting_link_id, user_id, added_by)
  values ('e9000000-0000-4000-8000-000000000002', 'e7000000-0000-4000-8000-000000000005', 'e7000000-0000-4000-8000-000000000004')
$$, '42501', null, 'individuals cannot invite people');
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.meeting_links where id = 'e9000000-0000-4000-8000-000000000002'), 0,
  'an individual who is not invited does not see a meeting with named participants');
select is((select count(*)::int from public.meeting_links where id = 'e9000000-0000-4000-8000-000000000001'), 1,
  'but still sees an everyone meeting without named participants (unchanged)');
select is((select count(*)::int from public.notifications where meeting_link_id is not null and user_id <> 'e7000000-0000-4000-8000-000000000005'), 0,
  'and cannot read anyone else''s notifications');

-- Admin of another workspace
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.meeting_links where workspace_id = 'e8000000-0000-4000-8000-000000000001'), 0,
  'an admin of another workspace sees none of its meetings');
select is((select count(*)::int from public.meeting_participants where meeting_link_id = 'e9000000-0000-4000-8000-000000000002'), 0,
  'nor their participants');

-- Super admin (no membership): schedules in an explicitly chosen workspace, sees everything
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$
  insert into public.meeting_links (id, workspace_id, title, url, created_by)
  values ('e9000000-0000-4000-8000-000000000003', 'e8000000-0000-4000-8000-000000000002', 'W2 planning', 'https://meet.example.com/w2', 'e7000000-0000-4000-8000-000000000001')
$$, 'a super admin schedules a meeting in a workspace they are not in');
select lives_ok($$
  insert into public.meeting_participants (meeting_link_id, user_id, added_by)
  values ('e9000000-0000-4000-8000-000000000003', 'e7000000-0000-4000-8000-000000000006', 'e7000000-0000-4000-8000-000000000001')
$$, 'and invites that workspace''s admin');
select is((select count(*)::int from public.meeting_links where id in ('e9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-000000000003')), 3,
  'a super admin sees meetings in every workspace');
select is((select count(*)::int from public.workspace_members where user_id = 'e7000000-0000-4000-8000-000000000001'), 0,
  'none of this makes the super admin a member');

-- The organiser changes and then cancels the meeting
set local request.jwt.claims to '{"sub":"e7000000-0000-4000-8000-000000000002","role":"authenticated"}';
update public.meeting_links set starts_at = '16:00', ends_at = '16:30' where id = 'e9000000-0000-4000-8000-000000000002';
update public.meeting_links set is_active = false where id = 'e9000000-0000-4000-8000-000000000002';
reset role;
set local request.jwt.claims to '';
select is((select string_agg(type::text, ',' order by type) from public.notifications
           where user_id = 'e7000000-0000-4000-8000-000000000004' and meeting_link_id = 'e9000000-0000-4000-8000-000000000002'),
  'MEETING_SCHEDULED,MEETING_UPDATED,MEETING_CANCELLED', 'participants are told about the change and the cancellation');
select is((select count(*)::int from public.notifications
           where user_id = 'e7000000-0000-4000-8000-000000000002' and meeting_link_id = 'e9000000-0000-4000-8000-000000000002'), 0,
  'the organiser is not notified of their own changes');
select is((select title from public.meeting_links where id = 'e9000000-0000-4000-8000-000000000002'), 'Design review',
  'the other admin''s edit had no effect');
select is((select count(*)::int from public.notifications
           where user_id = 'e7000000-0000-4000-8000-000000000006' and meeting_link_id = 'e9000000-0000-4000-8000-000000000003' and type = 'MEETING_SCHEDULED'), 1,
  'the invited admin of the other workspace is notified');

select * from finish();
rollback;
