-- Leave (CL, LWP, WFH), balances, approval and public holidays (034).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres): sa and sa2 (super admins), ad (admin), iv and iv2 (individuals).
-- 2027-01-01 is a Friday; 2027-01-04 a Monday.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('f5000000-0000-4000-8000-000000000001', 'sa@lv.test', '{"full_name":"SA"}'),
  ('f5000000-0000-4000-8000-000000000002', 'sa2@lv.test', '{"full_name":"SA2"}'),
  ('f5000000-0000-4000-8000-000000000003', 'ad@lv.test', '{"full_name":"AD"}'),
  ('f5000000-0000-4000-8000-000000000004', 'iv@lv.test', '{"full_name":"IV"}'),
  ('f5000000-0000-4000-8000-000000000005', 'iv2@lv.test', '{"full_name":"IV2"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('f5000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000002');
update public.profiles set role = 'ADMIN' where id = 'f5000000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- Public holidays: super admins only, one per date
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ insert into public.hr_public_holidays (name, holiday_date) values ('Fake', '2027-01-27') $$,
  '42501', null, 'an individual cannot add a holiday');
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ insert into public.hr_public_holidays (name, holiday_date) values ('Fake', '2027-01-27') $$,
  '42501', null, 'nor can an admin');
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ insert into public.hr_public_holidays (name, holiday_date, description) values ('Republic Day', '2027-01-26', 'National holiday') $$,
  'a super admin adds a holiday');
select throws_ok($$ insert into public.hr_public_holidays (name, holiday_date) values ('Duplicate', '2027-01-26') $$,
  '23505', null, 'a second active holiday on the same date is refused');
select ok((select created_by = 'f5000000-0000-4000-8000-000000000001' and created_at = now() from public.hr_public_holidays where holiday_date = '2027-01-26'),
  'the holiday records who created it and when');
select throws_ok($$ delete from public.hr_public_holidays $$, '42501', null, 'holidays are never deleted');
reset role;
set local request.jwt.claims to '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.hr_public_holidays where holiday_date = '2027-01-26'), 1, 'every active employee sees the company holidays');
select is(public.hr_working_days('2027-01-25', '2027-01-31'), 5, 'working days exclude Sundays and public holidays (Mon 25 - Sun 31 Jan, holiday on 26th)');
update public.hr_public_holidays set name = 'Hacked';
reset role;
set local request.jwt.claims to '';
select is((select name from public.hr_public_holidays where holiday_date = '2027-01-26'), 'Republic Day', 'an individual cannot edit a holiday');

-- ---------------------------------------------------------------------------
-- Applying (iv)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok($$ select public.hr_apply_leave('CL', '2027-01-04', '2027-01-08', 'Family function') $$, 'iv applies for 5 days of CL');
select is((select format('%s|%s|%s', status, working_days, decided_by is null) from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'CL'),
  'PENDING|5|t', 'the application is pending with 5 working days');
select is((select format('%s|%s|%s|%s', allowance, approved, pending, available) from public.hr_leave_balance(null, 2027) where leave_type = 'CL'),
  '12.0|0|5|7.0', 'CL: 12 allowed, 5 pending, 7 available');
select throws_ok($$ select public.hr_apply_leave('CL', '2027-01-07', '2027-01-12', 'Overlap') $$,
  '23P01', null, 'an overlapping application is refused');
select throws_ok($$ select public.hr_apply_leave('WFH', '2027-01-08', '2027-01-08', 'Overlap') $$,
  '23P01', null, 'whatever its type');
select throws_ok($$ select public.hr_apply_leave('CL', '2027-02-01', '2027-02-12', 'Too long') $$,
  '23514', 'Not enough Casual Leave: 7.0 day(s) available, 11 requested.', 'CL beyond the balance is refused (Mon 1 - Fri 12 Feb: 11 working days, Saturday counts)');
select lives_ok($$ select public.hr_apply_leave('LWP', '2027-02-01', '2027-02-12', 'Personal travel') $$, 'LWP has no balance limit');
select lives_ok($$ select public.hr_apply_leave('WFH', '2027-03-01', '2027-03-01', 'Internet installation at home') $$, 'WFH can be requested');
select is((select available from public.hr_leave_balance(null, 2027) where leave_type = 'CL'), 7.0::numeric, 'LWP and WFH do not use the CL balance');
select throws_ok($$ select public.hr_apply_leave('CL', '2027-01-10', '2027-01-10', 'Sunday') $$,
  '22023', 'There are no working days in these dates (Sundays and public holidays are not counted).', 'a Sunday alone has no working days');
select throws_ok($$ select public.hr_apply_leave('CL', '2026-12-31', '2027-01-01', 'Year end') $$,
  '22023', null, 'an application cannot cross into another year');
select throws_ok($$ select public.hr_apply_leave('CL', '2027-03-05', '2027-03-04', 'Backwards') $$, '22023', null, 'the end date cannot be before the start');
select throws_ok($$ select public.hr_apply_leave('CL', '2027-03-04', '2027-03-04', ' x ') $$, '22023', null, 'a reason is required');
select throws_ok($$ insert into public.hr_leave_applications (user_id, leave_type, start_date, end_date, working_days, reason, status)
                   values ('f5000000-0000-4000-8000-000000000004', 'CL', '2027-04-05', '2027-04-05', 1, 'forged', 'APPROVED') $$,
  '42501', null, 'an application cannot be written directly (e.g. pre-approved)');
select throws_ok($$ update public.hr_leave_applications set status = 'APPROVED' $$, '42501', null, 'nor approved directly');
select throws_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'CL'), true) $$,
  '42501', 'Only a super admin can approve or reject leave.', 'an individual cannot approve, not even their own');
select throws_ok($$ select * from public.hr_leave_balance('f5000000-0000-4000-8000-000000000005', 2027) $$,
  '42501', null, 'nor see someone else''s balance');
select throws_ok($$ insert into public.hr_leave_allowances (user_id, year, leave_type, days) values ('f5000000-0000-4000-8000-000000000004', 2027, 'CL', 30) $$,
  '42501', null, 'nor raise their own allowance');
with u as (update public.hr_leave_policies set annual_allowance = 50 where leave_type = 'CL' returning 1)
select is((select count(*)::int from u), 0, 'nor change the leave policy');

set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.hr_leave_applications), 0, 'an admin does not see other people''s applications');
select throws_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications limit 1), true) $$,
  '42501', null, 'nor decide them');
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.hr_leave_applications), 0, 'another individual sees none of iv''s applications');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Deciding (sa)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004'), 3, 'a super admin sees every application');
select lives_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'CL'), true) $$, 'sa approves the CL');
select is((select format('%s|%s|%s', status, decided_by, decided_at = now()) from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'CL'),
  'APPROVED|f5000000-0000-4000-8000-000000000001|t', 'the approver and time are recorded');
select throws_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'CL'), false, 'changed my mind') $$,
  '55000', null, 'a decided application cannot be decided again');
select throws_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'LWP'), false, '') $$,
  '22023', null, 'a rejection needs a reason');
select lives_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'LWP'), false, 'Peak delivery week') $$, 'sa rejects the LWP with a reason');
select is((select format('%s|%s', status, rejection_reason) from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'LWP'), 'REJECTED|Peak delivery week', 'the rejection reason is kept');
select is((select format('%s|%s|%s', approved, pending, available) from public.hr_leave_balance('f5000000-0000-4000-8000-000000000004', 2027) where leave_type = 'CL'),
  '5|0|7.0', 'approved CL uses the balance');
select is((select approved from public.hr_leave_balance('f5000000-0000-4000-8000-000000000004', 2027) where leave_type = 'LWP'), 0, 'a rejected LWP counts for nothing');

-- A super admin never decides their own application.
select lives_ok($$ select public.hr_apply_leave('WFH', '2027-03-02', '2027-03-02', 'Plumber visit') $$, 'sa applies for WFH');
select throws_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000001'), true) $$,
  '42501', 'You cannot approve or reject your own leave application.', 'sa cannot approve their own application');
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.hr_decide_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000001'), true) $$,
  'another super admin can');

-- Allowance override and policy change, both audited.
select lives_ok($$ insert into public.hr_leave_allowances (user_id, year, leave_type, days) values ('f5000000-0000-4000-8000-000000000004', 2027, 'CL', 15) $$,
  'a super admin sets iv''s 2027 CL allowance to 15');
select is((select format('%s|%s', allowance, available) from public.hr_leave_balance('f5000000-0000-4000-8000-000000000004', 2027) where leave_type = 'CL'),
  '15.0|10.0', 'the override applies to iv only');
select is((select available from public.hr_leave_balance('f5000000-0000-4000-8000-000000000005', 2027) where leave_type = 'CL'), 12.0::numeric, 'others keep the policy allowance');
update public.hr_leave_policies set annual_allowance = 10 where leave_type = 'CL';
select is((select available from public.hr_leave_balance('f5000000-0000-4000-8000-000000000005', 2027) where leave_type = 'CL'), 10.0::numeric, 'a policy change applies to everyone without an override');

-- A holiday added later gives the CL day back (the balance is recalculated).
insert into public.hr_public_holidays (name, holiday_date) values ('Company day', '2027-01-06');
select is((select format('%s|%s', approved, available) from public.hr_leave_balance('f5000000-0000-4000-8000-000000000004', 2027) where leave_type = 'CL'),
  '4|11.0', 'after a holiday on Wed 6 Jan the approved CL counts 4 days');
update public.hr_public_holidays set is_active = false where holiday_date = '2027-01-06';
select is((select approved from public.hr_leave_balance('f5000000-0000-4000-8000-000000000004', 2027) where leave_type = 'CL'), 5, 'cancelling it counts the day again');
select lives_ok($$ insert into public.hr_public_holidays (name, holiday_date) values ('Company day (moved)', '2027-01-06') $$,
  'a cancelled holiday''s date can be used again');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Cancelling, rejected dates, audit
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok($$ select public.hr_cancel_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'WFH')) $$, 'iv cancels the pending WFH');
select throws_ok($$ select public.hr_cancel_leave((select id from public.hr_leave_applications where user_id = 'f5000000-0000-4000-8000-000000000004' and leave_type = 'CL')) $$,
  '55000', null, 'an approved application cannot be cancelled by the applicant');
select lives_ok($$ select public.hr_apply_leave('LWP', '2027-02-01', '2027-02-02', 'Rescheduled travel') $$,
  'dates of a rejected application can be applied for again');
select is((select string_agg(action, ',' order by id) from public.attendance_audit_log where target_user_id = 'f5000000-0000-4000-8000-000000000004'),
  'LEAVE_APPLIED,LEAVE_APPLIED,LEAVE_APPLIED,LEAVE_APPROVED,LEAVE_REJECTED,LEAVE_ALLOWANCE_SET,LEAVE_CANCELLED,LEAVE_APPLIED',
  'iv''s audit history lists every application, decision, allowance change and cancellation');
select is((select count(*)::int from public.attendance_audit_log where action like 'HOLIDAY%'), 0, 'holiday audit entries are not visible to individuals');
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.attendance_audit_log where action in ('HOLIDAY_CREATED', 'HOLIDAY_CANCELLED', 'LEAVE_POLICY_UPDATED') and created_at = now()), 5,
  'holiday and policy changes are audited');

-- Leave is work history: such an employee cannot be deleted.
select ok(private.profile_has_history('f5000000-0000-4000-8000-000000000004'), 'leave applications count as employee history');

-- ---------------------------------------------------------------------------
-- Anonymous and deactivated callers
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.hr_apply_leave('CL', '2027-04-05', '2027-04-05', 'anon') $$, '42501', null, 'anonymous callers cannot apply');
select throws_ok($$ select count(*) from public.hr_public_holidays $$, '42501', null, 'nor read holidays');
reset role;
update public.profiles set is_active = false where id = 'f5000000-0000-4000-8000-000000000005';
set local role authenticated;
set local request.jwt.claims to '{"sub":"f5000000-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$ select public.hr_apply_leave('CL', '2027-04-05', '2027-04-05', 'inactive') $$, '42501', null, 'a deactivated employee cannot apply');
select is((select count(*)::int from public.hr_public_holidays), 0, 'nor read holidays');
select is((select count(*)::int from public.hr_leave_policies), 0, 'nor the leave policy');
reset role;
set local request.jwt.claims to '';

select * from finish();
rollback;
