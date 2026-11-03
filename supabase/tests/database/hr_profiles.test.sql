-- HR profiles, employee IDs, identity data and private photos (035).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Employee IDs
-- ---------------------------------------------------------------------------
select is((select count(*)::int from public.profiles p where not exists (select 1 from public.hr_employee_profiles h where h.user_id = p.id)), 0,
  'every existing employee has an HR profile');
select is((select count(*)::int from public.hr_employee_profiles where employee_code !~ '^CH-[0-9]{4,}$'), 0, 'every employee ID looks like CH-0001');

-- Fixtures (as postgres): sa (super admin), ad (admin), iv and iv2 (individuals).
insert into auth.users (id, email, raw_user_meta_data) values
  ('a8000000-0000-4000-8000-000000000001', 'sa@hp.test', '{"full_name":"SA"}'),
  ('a8000000-0000-4000-8000-000000000002', 'ad@hp.test', '{"full_name":"AD"}'),
  ('a8000000-0000-4000-8000-000000000003', 'iv@hp.test', '{"full_name":"IV"}'),
  ('a8000000-0000-4000-8000-000000000004', 'iv2@hp.test', '{"full_name":"IV2"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'a8000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id = 'a8000000-0000-4000-8000-000000000002';

select is((select count(*)::int from public.hr_employee_profiles where user_id::text like 'a8000000-%'), 4, 'a new employee gets an HR profile with their account');
select ok((select substr(max(employee_code), 4)::int > 0 from public.hr_employee_profiles where user_id::text like 'a8000000-%'), 'with an employee ID');
select ok((select (select substr(employee_code, 4)::int from public.hr_employee_profiles where user_id = 'a8000000-0000-4000-8000-000000000004')
                > (select substr(employee_code, 4)::int from public.hr_employee_profiles where user_id = 'a8000000-0000-4000-8000-000000000003')),
  'IDs are issued in order');
select is((select count(*)::int from (select employee_code from public.hr_employee_profiles group by 1 having count(*) > 1) d), 0, 'IDs are unique');
select throws_ok($$ update public.hr_employee_profiles set employee_code = 'CH-9999' where user_id = 'a8000000-0000-4000-8000-000000000003' $$,
  '55000', 'Employee IDs cannot be changed.', 'an employee ID can never be changed, not even directly in the database');

-- ---------------------------------------------------------------------------
-- HR profile access
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ update public.hr_employee_profiles set phone = '+91 98450 00000', date_of_birth = '1994-05-01', joining_date = '2024-06-03',
                   employment_type = 'FULL_TIME', employment_status = 'PROBATION', personal_email = 'iv.personal@mail.test', gender = 'FEMALE'
                   where user_id = 'a8000000-0000-4000-8000-000000000003' $$, 'a super admin edits an HR profile');
select throws_ok($$ update public.hr_employee_profiles set employee_code = 'CH-0001' where user_id = 'a8000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'the ID column cannot even be addressed by a signed-in user');
select throws_ok($$ update public.hr_employee_profiles set phone = 'call me' where user_id = 'a8000000-0000-4000-8000-000000000003' $$, '23514', null, 'invalid phone numbers are refused');
reset role;
set local request.jwt.claims to '';
select is((select details -> 'fields' from public.attendance_audit_log where action = 'HR_PROFILE_UPDATED' and target_user_id = 'a8000000-0000-4000-8000-000000000003'),
  '["date_of_birth", "employment_status", "gender", "joining_date", "personal_email", "phone"]'::jsonb,
  'the change is audited by field name only, never with the values');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select format('%s|%s', phone, employment_status) from public.hr_employee_profiles where user_id = 'a8000000-0000-4000-8000-000000000003'),
  '+91 98450 00000|PROBATION', 'an employee reads their own HR profile');
select is((select count(*)::int from public.hr_employee_profiles where user_id <> 'a8000000-0000-4000-8000-000000000003'), 0, 'and nobody else''s');
with u as (update public.hr_employee_profiles set phone = '+91 1111111111' where user_id = 'a8000000-0000-4000-8000-000000000003' returning 1)
select is((select count(*)::int from u), 0, 'an employee cannot edit their HR profile');
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.hr_employee_profiles where user_id <> 'a8000000-0000-4000-8000-000000000002'), 0, 'a workspace admin sees no one else''s HR profile');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Identity: PAN ciphertext and last four, Aadhaar last four
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ select public.hr_set_identity('a8000000-0000-4000-8000-000000000003', 'v1:x', 1::smallint, '234F', '1234', true, true) $$,
  '42501', null, 'an employee cannot set identity data, not even their own');
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.hr_set_identity('a8000000-0000-4000-8000-000000000003',
                   'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAA==', 1::smallint, '234F', '1234', true, true) $$,
  'a super admin stores the encrypted PAN and the Aadhaar last four');
select throws_ok($$ select public.hr_set_identity('a8000000-0000-4000-8000-000000000004', null, null, null, '123456789012', false, true) $$,
  '23514', null, 'a full Aadhaar number cannot be stored');
select throws_ok($$ select public.hr_set_identity('a8000000-0000-4000-8000-000000000004', 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAA==', 1::smallint, 'ABCDE1234F', null, true, false) $$,
  '23514', null, 'nor a full PAN in the last-four column');
select throws_ok($$ select public.hr_set_identity('a8000000-0000-4000-8000-000000000004', 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAA==', null, '234F', null, true, false) $$,
  '23514', null, 'a PAN needs its key version');
select throws_ok($$ select pan_ciphertext from public.hr_employee_identity $$, '42501', null, 'not even a super admin can read the PAN ciphertext through the API');
select is((select format('%s|%s', pan_last4, aadhaar_last4) from public.hr_employee_identity where user_id = 'a8000000-0000-4000-8000-000000000003'), '234F|1234',
  'a super admin reads the masked values');
select throws_ok($$ select public.hr_log_pan_reveal('a8000000-0000-4000-8000-000000000003', '') $$, '22023', null, 'a reveal needs a reason');
select throws_ok($$ select public.hr_log_pan_reveal('a8000000-0000-4000-8000-000000000004', 'Payroll setup') $$, 'P0002', null, 'there is nothing to reveal without a PAN');
select lives_ok($$ select public.hr_log_pan_reveal('a8000000-0000-4000-8000-000000000003', 'Payroll setup') $$, 'a super admin records a reveal with a reason');
reset role;
set local request.jwt.claims to '';
select is((select string_agg(action, ',' order by id) from public.attendance_audit_log
           where target_user_id = 'a8000000-0000-4000-8000-000000000003' and action in ('IDENTITY_UPDATED', 'PAN_REVEALED')),
  'IDENTITY_UPDATED,PAN_REVEALED', 'identity changes and reveals are audited');
select is((select details::text from public.attendance_audit_log where action = 'IDENTITY_UPDATED' and target_user_id = 'a8000000-0000-4000-8000-000000000003'),
  '{"fields": ["pan", "aadhaar_last4"]}', 'without any identity values');
select is((select actor_id from public.attendance_audit_log where action = 'PAN_REVEALED' and target_user_id = 'a8000000-0000-4000-8000-000000000003'),
  'a8000000-0000-4000-8000-000000000001'::uuid, 'with the super admin who revealed it');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select format('%s|%s', pan_last4, aadhaar_last4) from public.hr_employee_identity), '234F|1234', 'an employee sees their own masked identity');
select throws_ok($$ select public.hr_log_pan_reveal('a8000000-0000-4000-8000-000000000003', 'curious') $$, '42501', null, 'but cannot reveal a full PAN');
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.hr_employee_identity), 0, 'a workspace admin sees no identity data at all');
select throws_ok($$ select public.hr_log_pan_reveal('a8000000-0000-4000-8000-000000000003', 'curious') $$, '42501', null, 'nor reveal it');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Private photos
-- ---------------------------------------------------------------------------
select ok((select not public from storage.buckets where id = 'hr-photos'), 'the photo bucket is private');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('hr-photos', 'a8000000-0000-4000-8000-000000000003/me.jpg') $$,
  '42501', null, 'an employee cannot upload photos');
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ insert into storage.objects (bucket_id, name) values
                   ('hr-photos', 'a8000000-0000-4000-8000-000000000003/photo.jpg'),
                   ('hr-photos', 'a8000000-0000-4000-8000-000000000004/photo.jpg') $$, 'a super admin uploads photos');
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select string_agg(name, ',') from storage.objects where bucket_id = 'hr-photos'), 'a8000000-0000-4000-8000-000000000003/photo.jpg',
  'an employee can read only their own photo');
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'hr-photos'), 0, 'a workspace admin cannot read employee photos');
reset role;
set local request.jwt.claims to '';

-- ---------------------------------------------------------------------------
-- Deactivated and anonymous callers
-- ---------------------------------------------------------------------------
update public.profiles set is_active = false where id = 'a8000000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a8000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.hr_employee_profiles), 0, 'a deactivated employee sees no HR profile');
select is((select count(*)::int from public.hr_employee_identity), 0, 'nor identity data');
select is((select count(*)::int from storage.objects where bucket_id = 'hr-photos'), 0, 'nor their photo');
reset role;
set local request.jwt.claims to '';
set local role anon;
select throws_ok($$ select count(*) from public.hr_employee_profiles $$, '42501', null, 'anonymous callers read nothing');
reset role;

select * from finish();
rollback;
