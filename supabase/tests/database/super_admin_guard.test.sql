-- At least one active super admin always remains (migration 015).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres): s1 and s2 are super admins sharing workspace W,
-- ad = admin, iv = individual.
insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-4000-8000-000000000001', 's1@guard.test', '{"full_name":"S1"}'),
  ('5a000000-0000-4000-8000-000000000002', 's2@guard.test', '{"full_name":"S2"}'),
  ('5a000000-0000-4000-8000-000000000003', 'ad@guard.test', '{"full_name":"AD"}'),
  ('5a000000-0000-4000-8000-000000000004', 'iv@guard.test', '{"full_name":"IV"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000002');
update public.profiles set role = 'ADMIN' where id = '5a000000-0000-4000-8000-000000000003';
insert into public.workspaces (id, name, created_by) values
  ('5b000000-0000-4000-8000-000000000001', 'W', '5a000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id) values
  ('5b000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000002'),
  ('5b000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000003'),
  ('5b000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000004');

-- Leave s1 and s2 as the only active super admins (seed accounts included;
-- everything here is rolled back). Allowed: two remain.
select lives_ok($$
  update public.profiles set is_active = false
  where role = 'SUPER_ADMIN' and is_active
    and id not in ('5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000002')
$$, 'other super admins can be deactivated while s1 and s2 remain');
select is((select count(*)::int from public.profiles where role = 'SUPER_ADMIN' and is_active), 2, 'exactly two active super admins');

-- ---------------------------------------------------------------------------
-- Allowed while another active super admin remains (through the app's path)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"5a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ update public.profiles set role = 'ADMIN' where id = '5a000000-0000-4000-8000-000000000002' $$,
  'a super admin can demote another super admin while one remains');
select ok(exists (
  select 1 from pg_locks
  where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 1
    and objid::bigint = (hashtext('public.profiles:keep_last_super_admin')::bigint & 4294967295)
), 'the check takes the shared advisory lock, so concurrent demotions run one at a time');
reset role;
set local request.jwt.claims to '';
select is((select role::text from public.profiles where id = '5a000000-0000-4000-8000-000000000002'), 'ADMIN', 's2 is now an admin');

-- ---------------------------------------------------------------------------
-- s1 is now the last active super admin
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.profiles set role = 'ADMIN' where id = '5a000000-0000-4000-8000-000000000001' $$,
  '23514', 'At least one active super admin must remain. Make another person a super admin first.',
  'the last active super admin cannot be demoted (direct database access)');
select throws_ok($$ update public.profiles set is_active = false where id = '5a000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'the last active super admin cannot be deactivated (direct database access)');
select lives_ok($$ update public.profiles set full_name = 'S One', team = 'Leadership', job_title = 'Founder'
                   where id = '5a000000-0000-4000-8000-000000000001' $$,
  'other fields of the last super admin can still be updated');

-- Unauthorized callers cannot get around it: the demoted s2, the admin and
-- the individual are refused or filtered before the guard is reached.
set local role authenticated;
set local request.jwt.claims to '{"sub":"5a000000-0000-4000-8000-000000000002","role":"authenticated"}';
update public.profiles set role = 'ADMIN' where id = '5a000000-0000-4000-8000-000000000001';
set local request.jwt.claims to '{"sub":"5a000000-0000-4000-8000-000000000003","role":"authenticated"}';
update public.profiles set is_active = false where id = '5a000000-0000-4000-8000-000000000001';
set local request.jwt.claims to '{"sub":"5a000000-0000-4000-8000-000000000004","role":"authenticated"}';
update public.profiles set role = 'INDIVIDUAL' where id = '5a000000-0000-4000-8000-000000000001';
select throws_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = '5a000000-0000-4000-8000-000000000004' $$,
  '42501', null, 'an individual still cannot promote themselves');
set local request.jwt.claims to '{"sub":"5a000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ update public.profiles set role = 'ADMIN' where id = '5a000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'the last super admin demoting themselves still gets the existing permission error');
reset role;
set local request.jwt.claims to '';
select ok((select role = 'SUPER_ADMIN' and is_active from public.profiles where id = '5a000000-0000-4000-8000-000000000001'),
  's1 is still an active super admin after every unauthorized attempt');

-- ---------------------------------------------------------------------------
-- Deactivating is allowed while another remains
-- ---------------------------------------------------------------------------
select lives_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = '5a000000-0000-4000-8000-000000000002' $$,
  'promoting someone to super admin is unaffected');
set local role authenticated;
set local request.jwt.claims to '{"sub":"5a000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ update public.profiles set is_active = false where id = '5a000000-0000-4000-8000-000000000001' $$,
  'a super admin can deactivate another super admin while one remains');
reset role;
set local request.jwt.claims to '';
select is((select is_active from public.profiles where id = '5a000000-0000-4000-8000-000000000001'), false, 's1 is deactivated');
select throws_ok($$ update public.profiles set is_active = false where id = '5a000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'now s2 is the last one and cannot be deactivated');
select lives_ok($$ update public.profiles set is_active = true where id = '5a000000-0000-4000-8000-000000000001' $$,
  'reactivating a super admin is unaffected');

-- ---------------------------------------------------------------------------
-- Removing both at once (what two simultaneous demotions would amount to)
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.profiles set role = 'ADMIN'
                   where id in ('5a000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000002') $$,
  '23514', null, 'demoting every remaining super admin in one statement is rejected');
select is((select count(*)::int from public.profiles where role = 'SUPER_ADMIN' and is_active), 2,
  'the rejected statement changed nothing');

select * from finish();
rollback;
