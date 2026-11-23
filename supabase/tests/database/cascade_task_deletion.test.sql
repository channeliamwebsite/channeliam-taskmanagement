-- Safe cascading task deletion (050): a task and its subtasks, at any
-- nesting depth, delete together atomically as long as nothing in the whole
-- subtree is comments, attachments, logged time, or a daily-report/meeting
-- follow-up reference -- in which case the entire deletion is refused, same
-- as a single task with history already was (027). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures. W: adm (creator/owner of everything below), ind (a workspace
-- member with no ownership of any task here, for the unauthorized case).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8e000000-0000-4000-8000-000000000001', 'adm@casc.test', '{"full_name":"ADM"}'),
  ('8e000000-0000-4000-8000-000000000002', 'ind@casc.test', '{"full_name":"IND"}');
update public.profiles set role = 'ADMIN' where id = '8e000000-0000-4000-8000-000000000001';
insert into public.workspaces (id, name, created_by) values
  ('9e000000-0000-4000-8000-000000000001', 'CASC', '8e000000-0000-4000-8000-000000000001');
-- adm (the creator) is added as a member automatically; only ind needs it explicitly.
insert into public.workspace_members (workspace_id, user_id) values
  ('9e000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000002');
insert into public.projects (id, workspace_id, name, created_by, owner_id) values
  ('ae000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'CASC project',
   '8e000000-0000-4000-8000-000000000001', '8e000000-0000-4000-8000-000000000001');

-- Scenario tasks (all created by adm, in the same project). parent_task_id
-- wires up each subtree.
insert into public.tasks (id, workspace_id, project_id, parent_task_id, title, created_by) values
  -- 1. No subtasks at all.
  ('be000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'Lonely', '8e000000-0000-4000-8000-000000000001'),
  -- 2. One parent, two clean direct children.
  ('be000000-0000-4000-8000-000000000002', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'CleanParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000003', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000002', 'CleanChild1', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000004', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000002', 'CleanChild2', '8e000000-0000-4000-8000-000000000001'),
  -- 3. Three levels deep, all clean.
  ('be000000-0000-4000-8000-000000000005', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'DeepParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000006', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000005', 'DeepChild', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000007', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000006', 'DeepGrandchild', '8e000000-0000-4000-8000-000000000001'),
  -- 4. A comment on a descendant blocks the whole subtree.
  ('be000000-0000-4000-8000-000000000008', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'CommentParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000009', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000008', 'CommentChild', '8e000000-0000-4000-8000-000000000001'),
  -- 5. An attachment on a descendant blocks the whole subtree.
  ('be000000-0000-4000-8000-000000000010', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'AttachParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000011', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000010', 'AttachChild', '8e000000-0000-4000-8000-000000000001'),
  -- 6. A time entry on a descendant blocks the whole subtree.
  ('be000000-0000-4000-8000-000000000012', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'TimeParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000013', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000012', 'TimeChild', '8e000000-0000-4000-8000-000000000001'),
  -- 7. A daily report's linked_task_ids references a descendant.
  ('be000000-0000-4000-8000-000000000014', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'ReportParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000015', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000014', 'ReportChild', '8e000000-0000-4000-8000-000000000001'),
  -- 7b. A daily report's evening_snapshot (jsonb) references a descendant.
  ('be000000-0000-4000-8000-000000000016', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'SnapshotParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000017', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000016', 'SnapshotChild', '8e000000-0000-4000-8000-000000000001'),
  -- 8. A meeting follow-up references a descendant.
  ('be000000-0000-4000-8000-000000000018', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'MeetingParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000019', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000018', 'MeetingChild', '8e000000-0000-4000-8000-000000000001'),
  -- 9. Atomic rollback: one clean child, one child with a comment.
  ('be000000-0000-4000-8000-000000000020', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'MixedParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000021', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000020', 'MixedCleanChild', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000022', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000020', 'MixedHistoryChild', '8e000000-0000-4000-8000-000000000001'),
  -- 10. Unauthorized: clean subtree, but deleted by someone who isn't the creator/owner.
  ('be000000-0000-4000-8000-000000000023', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', null, 'UnauthParent', '8e000000-0000-4000-8000-000000000001'),
  ('be000000-0000-4000-8000-000000000024', '9e000000-0000-4000-8000-000000000001', 'ae000000-0000-4000-8000-000000000001', 'be000000-0000-4000-8000-000000000023', 'UnauthChild', '8e000000-0000-4000-8000-000000000001');

insert into public.task_comments (task_id, user_id, comment) values
  ('be000000-0000-4000-8000-000000000009', '8e000000-0000-4000-8000-000000000001', 'a comment on the descendant'),
  ('be000000-0000-4000-8000-000000000022', '8e000000-0000-4000-8000-000000000001', 'a comment on the mixed descendant');
insert into public.task_attachments (task_id, uploaded_by, file_name, file_url) values
  ('be000000-0000-4000-8000-000000000011', '8e000000-0000-4000-8000-000000000001', 'notes.pdf', 'https://example.test/notes.pdf');
insert into public.time_entries (task_id, user_id, started_at, ended_at, duration_minutes) values
  ('be000000-0000-4000-8000-000000000013', '8e000000-0000-4000-8000-000000000001', '2026-10-26 04:00+00', '2026-10-26 05:00+00', 60);
insert into public.daily_reports (user_id, workspace_id, report_date, linked_task_ids) values
  ('8e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', '2026-10-26', array['be000000-0000-4000-8000-000000000015']::uuid[]);
insert into public.daily_reports (user_id, workspace_id, report_date, evening_snapshot) values
  ('8e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', '2026-10-27',
   jsonb_build_object('version', 1, 'tasks', jsonb_build_array(jsonb_build_object('id', 'be000000-0000-4000-8000-000000000017'))));
insert into public.meeting_links (id, workspace_id, title, url, created_by) values
  ('5e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', 'Stand-up', 'https://meet.example.com/casc', '8e000000-0000-4000-8000-000000000001');
insert into public.meeting_records (id, workspace_id, meeting_link_id, meeting_date, follow_up_task_ids) values
  ('6e000000-0000-4000-8000-000000000001', '9e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000001', '2026-10-26',
   array['be000000-0000-4000-8000-000000000019']::uuid[]);

set local role authenticated;
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 1. Parent with no subtasks: unaffected by this migration, still deletes.
-- ---------------------------------------------------------------------------
select results_eq($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000001' returning title $$,
  $$ values ('Lonely'::text) $$, 'a task with no subtasks still deletes on its own');

-- ---------------------------------------------------------------------------
-- 2. Parent with multiple (clean) direct subtasks: cascades atomically.
-- ---------------------------------------------------------------------------
select lives_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000002' $$,
  'a parent with two clean direct subtasks can now be deleted');
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000002', 'be000000-0000-4000-8000-000000000003', 'be000000-0000-4000-8000-000000000004')),
  0, 'the parent and both of its clean subtasks are gone');

-- ---------------------------------------------------------------------------
-- 3. Deeply nested (3 levels), all clean: the whole chain cascades.
-- ---------------------------------------------------------------------------
select lives_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000005' $$,
  'a task with a clean grandchild (3 levels) can be deleted');
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000005', 'be000000-0000-4000-8000-000000000006', 'be000000-0000-4000-8000-000000000007')),
  0, 'the parent, child and grandchild are all gone -- unlimited nesting cascades');

-- ---------------------------------------------------------------------------
-- 4. Comments on a descendant: the existing protection still blocks it.
-- ---------------------------------------------------------------------------
select throws_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000008' $$,
  '55000', null, 'a parent whose subtask has a comment cannot be deleted');
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000008', 'be000000-0000-4000-8000-000000000009')),
  2, 'the parent and the commented subtask both remain');

-- ---------------------------------------------------------------------------
-- 5. Attachments on a descendant: still blocks.
-- ---------------------------------------------------------------------------
select throws_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000010' $$,
  '55000', null, 'a parent whose subtask has an attachment cannot be deleted');
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000010', 'be000000-0000-4000-8000-000000000011')),
  2, 'the parent and the attached subtask both remain');

-- ---------------------------------------------------------------------------
-- 6. Time entries on a descendant: still blocks.
-- ---------------------------------------------------------------------------
select throws_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000012' $$,
  '55000', null, 'a parent whose subtask has logged time cannot be deleted');
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000012', 'be000000-0000-4000-8000-000000000013')),
  2, 'the parent and the timed subtask both remain');

-- ---------------------------------------------------------------------------
-- 7. Daily-report references on a descendant (array column and snapshot): blocks.
-- ---------------------------------------------------------------------------
select throws_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000014' $$,
  '55000', null, 'a parent whose subtask is in a daily report''s linked_task_ids cannot be deleted');
select throws_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000016' $$,
  '55000', null, 'a parent whose subtask is in a daily report''s evening_snapshot cannot be deleted');
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000014', 'be000000-0000-4000-8000-000000000015',
                 'be000000-0000-4000-8000-000000000016', 'be000000-0000-4000-8000-000000000017')),
  4, 'both report-referenced subtrees remain intact');

-- ---------------------------------------------------------------------------
-- 8. Meeting follow-up references on a descendant: blocks.
-- ---------------------------------------------------------------------------
select throws_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000018' $$,
  '55000', null, 'a parent whose subtask is a meeting follow-up cannot be deleted');
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000018', 'be000000-0000-4000-8000-000000000019')),
  2, 'the parent and the referenced subtask both remain');

-- ---------------------------------------------------------------------------
-- 9. Atomic rollback: one blocked descendant refuses the whole subtree, not
-- just the blocked one -- the clean sibling is not silently deleted either.
-- ---------------------------------------------------------------------------
select throws_ok($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000020' $$,
  '55000', null, 'a parent with one clean child and one commented child cannot be deleted');
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000020', 'be000000-0000-4000-8000-000000000021', 'be000000-0000-4000-8000-000000000022')),
  3, 'the parent, the clean child and the commented child all remain -- nothing was partially deleted');

-- ---------------------------------------------------------------------------
-- 10. Unauthorized deletion: RLS (unchanged) still refuses it, regardless of
-- the subtree being otherwise clean and deletable in principle.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"8e000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is_empty($$ delete from public.tasks where id = 'be000000-0000-4000-8000-000000000023' returning id $$,
  'a workspace member who did not create the task deletes nothing, clean subtree or not');
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.tasks
    where id in ('be000000-0000-4000-8000-000000000023', 'be000000-0000-4000-8000-000000000024')),
  2, 'the parent and child remain -- permissions are unchanged by this migration');

select * from finish();
rollback;
