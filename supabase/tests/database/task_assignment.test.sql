-- Task-assignee authorization (002, 006) and integrity (migration 022).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres, no user). W1: sa, ad (creates task T), ad2 (not
-- involved in T), iv, iv2, iv3. W2: ad3.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000001', 'sa@assign.test', '{"full_name":"SA"}'),
  ('c1000000-0000-4000-8000-000000000002', 'ad@assign.test', '{"full_name":"AD"}'),
  ('c1000000-0000-4000-8000-000000000003', 'ad2@assign.test', '{"full_name":"AD2"}'),
  ('c1000000-0000-4000-8000-000000000004', 'iv@assign.test', '{"full_name":"IV"}'),
  ('c1000000-0000-4000-8000-000000000005', 'iv2@assign.test', '{"full_name":"IV2"}'),
  ('c1000000-0000-4000-8000-000000000006', 'iv3@assign.test', '{"full_name":"IV3"}'),
  ('c1000000-0000-4000-8000-000000000007', 'ad3@assign.test', '{"full_name":"AD3"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'c1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN'
where id in ('c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000007');
insert into public.workspaces (id, name, created_by) values
  ('c2000000-0000-4000-8000-000000000001', 'W1', 'c1000000-0000-4000-8000-000000000001'),
  ('c2000000-0000-4000-8000-000000000002', 'W2', 'c1000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id) values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002'),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003'),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004'),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005'),
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000006'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000007');

-- Current assignees of T as "user*" (primary marked), ordered by name.
create temporary view t_assignees as
select string_agg(p.full_name || case when ta.is_primary then '*' else '' end, ',' order by p.full_name) as list
from public.task_assignees ta join public.profiles p on p.id = ta.user_id
where ta.task_id = 'c3000000-0000-4000-8000-000000000002';

insert into public.tasks (id, project_id, title, created_by) values
  ('c3000000-0000-4000-8000-000000000002', (select id from public.projects where workspace_id = 'c2000000-0000-4000-8000-000000000001' and is_default),
   'T', 'c1000000-0000-4000-8000-000000000002');
insert into public.task_assignees (task_id, user_id, assigned_by, is_primary, assigned_at) values
  ('c3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000002', true, now() - interval '2 minutes'),
  ('c3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000002', false, now() - interval '1 minute');
select is((select list from t_assignees), 'IV*,IV2', 'T starts with iv as primary and iv2');

-- ---------------------------------------------------------------------------
-- People who cannot manage T cannot change its assignees, by any path
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002', array['c1000000-0000-4000-8000-000000000003']::uuid[]) $$,
  '42501', 'You don''t have permission to assign this task', 'an admin who cannot manage T cannot reassign it, even knowing its id');
select throws_ok($$ insert into public.task_assignees (task_id, user_id) values ('c3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'nor by inserting an assignee directly');
select is_empty($$ delete from public.task_assignees where task_id = 'c3000000-0000-4000-8000-000000000002' returning user_id $$,
  'nor by deleting assignees directly (filtered)');
select is_empty($$ update public.task_assignees set is_primary = true where task_id = 'c3000000-0000-4000-8000-000000000002' returning user_id $$,
  'nor by changing the primary directly (filtered)');
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002', array['c1000000-0000-4000-8000-000000000005']::uuid[]) $$,
  '42501', null, 'an individual assignee cannot reassign the task');
select is_empty($$ delete from public.task_assignees where task_id = 'c3000000-0000-4000-8000-000000000002' returning user_id $$,
  'nor remove other assignees or themselves');
select is_empty($$ update public.task_assignees set is_primary = true where task_id = 'c3000000-0000-4000-8000-000000000002' and user_id = 'c1000000-0000-4000-8000-000000000005' returning user_id $$,
  'nor make themselves primary');
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000007","role":"authenticated"}';
select throws_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002', array['c1000000-0000-4000-8000-000000000007']::uuid[]) $$,
  '42501', null, 'an admin of another workspace cannot reassign it');
reset role;
set local request.jwt.claims to '';
select is((select list from t_assignees), 'IV*,IV2', 'every refused attempt left the assignees unchanged');

-- ---------------------------------------------------------------------------
-- The manager: a task always keeps an assignee and a primary (022)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002', '{}'::uuid[]) $$,
  '23514', 'Assign at least one person', 'set_task_assignees refuses to remove everyone');
select throws_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002', array[null]::uuid[]) $$,
  '23514', null, 'a list of only nulls counts as empty');
select lives_ok($$ delete from public.task_assignees where task_id = 'c3000000-0000-4000-8000-000000000002' and user_id = 'c1000000-0000-4000-8000-000000000004' $$,
  'the manager removes the primary assignee directly');
reset role;
set local request.jwt.claims to '';
select is((select list from t_assignees), 'IV2*', 'the remaining assignee was promoted to primary');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ delete from public.task_assignees where task_id = 'c3000000-0000-4000-8000-000000000002' $$,
  '23514', 'Assign at least one person', 'the last assignee cannot be removed directly');
select lives_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002', array['c1000000-0000-4000-8000-000000000006']::uuid[]) $$,
  'replacing everyone with someone new works (added before the old one is removed)');
reset role;
set local request.jwt.claims to '';
select is((select list from t_assignees), 'IV3*', 'the newcomer is the only assignee and the primary');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002',
                     array['c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000006']::uuid[],
                     'c1000000-0000-4000-8000-000000000005') $$,
  'adding two people and choosing a new primary in one call');
reset role;
set local request.jwt.claims to '';
select is((select list from t_assignees), 'IV,IV2*,IV3', 'exactly the requested primary');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002',
                     array['c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000006']::uuid[]) $$,
  'removing the primary through the picker without naming a new one');
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.task_assignees where task_id = 'c3000000-0000-4000-8000-000000000002' and is_primary), 1,
  'a primary is still set');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002',
                     array['c1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000007']::uuid[]) $$,
  '23514', null, 'a reassignment that includes someone from another workspace fails');
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.task_assignees where task_id = 'c3000000-0000-4000-8000-000000000002'), 2,
  'and changes nothing (atomic)');

-- ---------------------------------------------------------------------------
-- Unchanged rules: assigned admins manage (M2), task deletion, trusted calls
-- ---------------------------------------------------------------------------
insert into public.task_assignees (task_id, user_id, assigned_by) values
  ('c3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001');
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$ select public.set_task_assignees('c3000000-0000-4000-8000-000000000002',
                     array['c1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000005']::uuid[]) $$,
  'an admin assigned to the task can manage its assignees (existing rule, unchanged)');
set local request.jwt.claims to '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ delete from public.tasks where id = 'c3000000-0000-4000-8000-000000000002' $$,
  'the creator can still delete the task (its assignees go with it)');
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.task_assignees where task_id = 'c3000000-0000-4000-8000-000000000002'), 0, 'no assignee rows remain');

insert into public.tasks (id, project_id, title) values
  ('c3000000-0000-4000-8000-000000000001', (select id from public.projects where workspace_id = 'c2000000-0000-4000-8000-000000000001' and is_default), 'Trusted');
insert into public.task_assignees (task_id, user_id, is_primary) values
  ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004', true);
select lives_ok($$ delete from public.task_assignees where task_id = 'c3000000-0000-4000-8000-000000000001' $$,
  'calls without a signed-in user (service role, SQL editor) are trusted, as for the other guards');

select * from finish();
rollback;
