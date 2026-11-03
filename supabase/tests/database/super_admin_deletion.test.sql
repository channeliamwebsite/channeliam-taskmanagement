-- The last active super admin cannot be deleted either (migration 021), while
-- deletion of others, deactivation and the 015 rules keep working.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres, no user). s1, s2, s3 = super admins with no work
-- history (so 016 does not interfere); s4 = a super admin deactivated below;
-- iv = individual. Nobody is in a workspace.
insert into auth.users (id, email, raw_user_meta_data) values
  ('b1000000-0000-4000-8000-000000000001', 's1@sadel.test', '{"full_name":"S1"}'),
  ('b1000000-0000-4000-8000-000000000002', 's2@sadel.test', '{"full_name":"S2"}'),
  ('b1000000-0000-4000-8000-000000000003', 's3@sadel.test', '{"full_name":"S3"}'),
  ('b1000000-0000-4000-8000-000000000004', 's4@sadel.test', '{"full_name":"S4"}'),
  ('b1000000-0000-4000-8000-000000000005', 'iv@sadel.test', '{"full_name":"IV"}');
update public.profiles set role = 'SUPER_ADMIN'
where id in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002',
             'b1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000004');

-- ---------------------------------------------------------------------------
-- Several active super admins: deleting one is allowed
-- ---------------------------------------------------------------------------
select lives_ok($$ delete from auth.users where id = 'b1000000-0000-4000-8000-000000000003' $$,
  'a super admin account can be deleted while other active super admins remain');
select ok(exists (
  select 1 from pg_locks
  where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 1
    and objid::bigint = (hashtext('public.profiles:keep_last_super_admin')::bigint & 4294967295)
), 'deletion takes the same advisory lock as demotion, so the checks run one at a time');
select is((select count(*)::int from public.profiles where id = 'b1000000-0000-4000-8000-000000000003'), 0, 'its profile is gone');
update public.profiles set is_active = false where id = 'b1000000-0000-4000-8000-000000000004';
select lives_ok($$ delete from auth.users where id = 'b1000000-0000-4000-8000-000000000004' $$,
  'a deactivated super admin can be deleted (not active, no history)');

-- Leave s1 and s2 as the only active super admins (seed accounts included;
-- everything here is rolled back).
select lives_ok($$
  update public.profiles set is_active = false
  where role = 'SUPER_ADMIN' and is_active
    and id not in ('b1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002')
$$, 'other active super admins are deactivated while two remain');
select lives_ok($$ delete from auth.users where id = 'b1000000-0000-4000-8000-000000000002' $$,
  'with two active super admins, one can still be deleted');

-- ---------------------------------------------------------------------------
-- s1 is now the last active super admin
-- ---------------------------------------------------------------------------
select throws_ok($$ delete from auth.users where id = 'b1000000-0000-4000-8000-000000000001' $$,
  '23514', 'At least one active super admin must remain. Make another person a super admin first.',
  'the last active super admin''s account cannot be deleted');
select throws_ok($$ delete from public.profiles where id = 'b1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'nor their profile directly');
set local app.allow_history_deletion = 'on';
select throws_ok($$ delete from auth.users where id = 'b1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'the 016 erasure override does not bypass it');
set local app.allow_history_deletion = 'off';
select throws_ok($$ update public.profiles set role = 'ADMIN' where id = 'b1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'demotion is still refused (015)');
select throws_ok($$ update public.profiles set is_active = false where id = 'b1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'deactivation is still refused (015)');
select ok((select role = 'SUPER_ADMIN' and is_active from public.profiles where id = 'b1000000-0000-4000-8000-000000000001')
          and exists (select 1 from auth.users where id = 'b1000000-0000-4000-8000-000000000001'),
  'account and profile are intact after every refused attempt');
select lives_ok($$ update public.profiles set full_name = 'Founder' where id = 'b1000000-0000-4000-8000-000000000001' $$,
  'other fields of the last super admin can still be changed');

-- ---------------------------------------------------------------------------
-- Signed-in users cannot delete accounts or profiles at all
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ delete from public.profiles where id = 'b1000000-0000-4000-8000-000000000005' $$,
  '42501', null, 'a super admin cannot delete a profile through the API');
select throws_ok($$ delete from auth.users where id = 'b1000000-0000-4000-8000-000000000005' $$,
  '42501', null, 'nor an auth account');
set local request.jwt.claims to '{"sub":"b1000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ delete from public.profiles where id = 'b1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'an individual cannot delete the super admin''s profile');
select throws_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = 'b1000000-0000-4000-8000-000000000005' $$,
  '42501', null, 'nor promote themselves to get around the guard');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Legitimate hand-over: promote someone, then offboard by deactivation
-- ---------------------------------------------------------------------------
select lives_ok($$ update public.profiles set role = 'SUPER_ADMIN' where id = 'b1000000-0000-4000-8000-000000000005' $$,
  'another person is made super admin');
select lives_ok($$ update public.profiles set is_active = false where id = 'b1000000-0000-4000-8000-000000000001' $$,
  'the former last super admin can now be deactivated');
select lives_ok($$ delete from auth.users where id = 'b1000000-0000-4000-8000-000000000001' $$,
  'and, having no history and no longer being active, deleted');
select throws_ok($$ delete from auth.users where id = 'b1000000-0000-4000-8000-000000000005' $$,
  '23514', null, 'the new super admin is now the protected one');
select is((select count(*)::int from public.profiles where role = 'SUPER_ADMIN' and is_active), 1,
  'exactly one active super admin remains');

select * from finish();
rollback;
