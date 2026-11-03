-- Monthly CL credits, 3-month validity, FIFO and balance checks (036).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures: sa (super admin), cl (individual, joined mid-January 2027), other (individual).
-- 2027-03-01 is a Monday; Sundays are the weekly off.
insert into auth.users (id, email, raw_user_meta_data) values
  ('f6000000-0000-4000-8000-000000000001', 'sa@cl.test', '{"full_name":"SA"}'),
  ('f6000000-0000-4000-8000-000000000002', 'cl@cl.test', '{"full_name":"CL"}'),
  ('f6000000-0000-4000-8000-000000000003', 'other@cl.test', '{"full_name":"Other"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'f6000000-0000-4000-8000-000000000001';
update public.profiles set created_at = '2027-01-15 10:00+05:30' where id = 'f6000000-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
-- Credit months and expiry
-- ---------------------------------------------------------------------------
select is(private.hr_cl_expiry('2027-01-01'), '2027-03-31'::date, 'a January credit is usable until 31 March');
select is(private.hr_cl_expiry('2027-02-01'), '2027-04-30'::date, 'February until 30 April');
select is(private.hr_cl_expiry('2027-03-01'), '2027-05-31'::date, 'March until 31 May');
select is(private.hr_cl_expiry('2026-12-01'), '2027-02-28'::date, 'December crosses the year (to 28 February)');
select is(private.hr_cl_expiry('2027-12-01'), '2028-02-29'::date, 'and reaches 29 February in a leap year');
select is(private.hr_cl_expiry('2027-11-01'), '2028-01-31'::date, 'November until 31 January');
select is(private.hr_cl_first_month('f6000000-0000-4000-8000-000000000002'), '2027-01-01'::date,
  'credits start in the joining (account creation) month, India time');

select is(private.hr_cl_available('f6000000-0000-4000-8000-000000000002', '2027-01-15'), 1, 'one credit on joining');
select is(private.hr_cl_available('f6000000-0000-4000-8000-000000000002', '2027-03-15'), 3, 'three after three months');
select is(private.hr_cl_available('f6000000-0000-4000-8000-000000000002', '2027-04-01'), 3, 'January''s credit expires as April''s arrives');
select is(private.hr_cl_available('f6000000-0000-4000-8000-000000000002', '2027-12-31'), 3, 'never more than three unused credits at once');
select is((select count(*)::int from private.hr_cl_allocate('f6000000-0000-4000-8000-000000000002', '{APPROVED,PENDING}', null, null, null, '2027-12-31')
           where extract(year from credit_month) = 2027), 12, '12 credits in a full year');
select is((select count(*)::int from private.hr_cl_allocate('f6000000-0000-4000-8000-000000000002', '{APPROVED,PENDING}', null, null, null, '2026-12-31')
           where credit_month is not null), 0, 'none before joining');

-- ---------------------------------------------------------------------------
-- Applying: FIFO, pending applications, expiry, insufficient balance
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.hr_apply_leave('CL', '2027-03-01', '2027-03-02', 'Family visit') $$, 'cl applies for 2 days in March');
reset role;
set local request.jwt.claims to '';
select is((select string_agg(to_char(credit_month, 'YYYY-MM'), ',' order by credit_month)
           from private.hr_cl_allocate('f6000000-0000-4000-8000-000000000002', '{APPROVED,PENDING}') where used = 1),
  '2027-01,2027-02', 'the oldest credits are used first (January, February)');
select is(private.hr_cl_available('f6000000-0000-4000-8000-000000000002', '2027-03-15'), 1, 'the pending application already reserves its credits');

set local role authenticated;
set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like($$ select public.hr_apply_leave('CL', '2027-03-03', '2027-03-05', 'Too many') $$,
  'Not enough Casual Leave: 2 of 3 day(s) are not covered by a valid monthly CL credit%', 'more CL than valid credits is refused');
select lives_ok($$ select public.hr_apply_leave('CL', '2027-03-03', '2027-03-03', 'One more day') $$, 'one day still fits (March''s credit)');
select throws_like($$ select public.hr_apply_leave('CL', '2027-03-04', '2027-03-04', 'Again') $$,
  'Not enough Casual Leave: 1 of 1 day(s)%', 'pending applications count: nothing is left for March');
select throws_like($$ select public.hr_apply_leave('CL', '2027-02-26', '2027-02-26', 'Earlier') $$,
  'Not enough Casual Leave%', 'an earlier date cannot take credits already used (no double counting)');
select lives_ok($$ select public.hr_apply_leave('CL', '2027-04-05', '2027-04-05', 'April') $$, 'April''s own credit covers an April day');
select throws_like($$ select public.hr_apply_leave('CL', '2027-04-06', '2027-04-06', 'Expired') $$,
  'Not enough Casual Leave%', 'January''s credit has expired by April, so a second April day is refused');
select lives_ok($$ select public.hr_apply_leave('LWP', '2027-04-06', '2027-04-06', 'Unpaid instead') $$, 'LWP is not limited by CL credits');
select lives_ok($$ select public.hr_apply_leave('CL', '2027-07-05', '2027-07-07', 'Summer') $$, 'unused May and June credits roll into July (May, June, July)');
select throws_like($$ select public.hr_apply_leave('CL', '2027-07-08', '2027-07-08', 'One too many') $$,
  'Not enough Casual Leave%', 'and no further');
-- Year transition: November and December credits are usable in January.
select lives_ok($$ select public.hr_apply_leave('CL', '2028-01-03', '2028-01-05', 'New year') $$, 'November, December and January credits cover 3 days in January 2028');
select is((select format('%s|%s', approved, pending) from public.hr_leave_balance(null, 2027) where leave_type = 'CL'), '0|7',
  'the balance lists pending CL days for the year');
select throws_ok($$ select * from public.hr_cl_credits('f6000000-0000-4000-8000-000000000003') $$, '42501', null, 'an employee cannot see someone else''s credits');
select lives_ok($$ select * from public.hr_cl_credits() $$, 'but sees their own');
reset role;
set local request.jwt.claims to '';
select is((select string_agg(to_char(credit_month, 'YYYY-MM'), ',' order by credit_month)
           from private.hr_cl_allocate('f6000000-0000-4000-8000-000000000002', '{APPROVED,PENDING}') where used = 1 and credit_month >= '2027-11-01'),
  '2027-11,2027-12,2028-01', 'FIFO across the year boundary');

-- ---------------------------------------------------------------------------
-- Approval, cancellation and history
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications where user_id = 'f6000000-0000-4000-8000-000000000002' and start_date = '2027-03-01'), true) $$,
  'a super admin approves CL that has credits');
select lives_ok($$ select * from public.hr_cl_credits('f6000000-0000-4000-8000-000000000002') $$, 'and can see the employee''s credits');
set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.hr_cancel_leave((select id from public.hr_leave_applications where user_id = 'f6000000-0000-4000-8000-000000000002' and start_date = '2027-03-03')) $$,
  'cancelling a pending CL');
select lives_ok($$ select public.hr_apply_leave('CL', '2027-03-04', '2027-03-04', 'Swap day') $$, 'gives its credit back');
reset role;
set local request.jwt.claims to '';

-- Historical CL decided under the old annual policy is kept as it was and
-- never blocks new requests it does not compete with.
insert into public.hr_leave_applications (user_id, leave_type, start_date, end_date, working_days, reason, status, decided_at)
values ('f6000000-0000-4000-8000-000000000003', 'CL', '2027-01-04', '2027-01-15', 11, 'Legacy annual CL', 'APPROVED', now());
update public.profiles set created_at = '2027-01-01 10:00+05:30' where id = 'f6000000-0000-4000-8000-000000000003';
select is(private.hr_cl_shortfall('f6000000-0000-4000-8000-000000000003', '{APPROVED,PENDING}'), 10, 'legacy CL beyond the credits shows as uncovered');
set local role authenticated;
set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$ select public.hr_apply_leave('CL', '2027-06-07', '2027-06-07', 'New request') $$, 'yet a new CL with its own credit is accepted');
reset role;
set local request.jwt.claims to '';
select is((select format('%s|%s', status, working_days) from public.hr_leave_applications where reason = 'Legacy annual CL'), 'APPROVED|11', 'and history is not rewritten');

-- Annual cap: the CL policy limits credits to months 1..N (at most 12).
set local role authenticated;
set local request.jwt.claims to '{"sub":"f6000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.hr_leave_policies set annual_allowance = 10 where leave_type = 'CL';
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from private.hr_cl_allocate('f6000000-0000-4000-8000-000000000003', '{APPROVED,PENDING}', null, null, null, '2027-12-31')
           where extract(year from credit_month) = 2027), 10, 'a policy of 10 gives 10 credits a year');

select * from finish();
rollback;
