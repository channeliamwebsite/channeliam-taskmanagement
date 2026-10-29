-- Signed-in users cannot delete a workspace, so its audit trail and employee
-- history cannot be erased through the API (migration 023).
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres, no user): sa = super admin of W, ad = admin, iv = individual.
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-4000-8000-000000000001', 'sa@wsdel.test', '{"full_name":"SA"}'),
  ('d1000000-0000-4000-8000-000000000002', 'ad@wsdel.test', '{"full_name":"AD"}'),
  ('d1000000-0000-4000-8000-000000000003', 'iv@wsdel.test', '{"full_name":"IV"}');
update public.profiles set role = 'SUPER_ADMIN' where id = 'd1000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN' where id = 'd1000000-0000-4000-8000-000000000002';
insert into public.workspaces (id, name, created_by) values
  ('d2000000-0000-4000-8000-000000000001', 'W', 'd1000000-0000-4000-8000-000000000001');
insert into public.workspace_members (workspace_id, user_id) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002'),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003');

-- Some history: a report by iv and an audited change by the super admin.
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select public.submit_evening_report('d2000000-0000-4000-8000-000000000001', 1, 'Worked');
set local request.jwt.claims to '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.profiles set team = 'Ops' where id = 'd1000000-0000-4000-8000-000000000003';
reset role;
set local request.jwt.claims to '';
create temporary table before_counts as
select (select count(*) from public.activity_logs where workspace_id = 'd2000000-0000-4000-8000-000000000001') as logs,
       (select count(*) from public.daily_reports where workspace_id = 'd2000000-0000-4000-8000-000000000001') as reports;
select ok((select logs > 0 and reports = 1 from before_counts), 'the workspace has audit entries and a report');

-- ---------------------------------------------------------------------------
-- Nobody signed in can delete the workspace
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is_empty($$ delete from public.workspaces where id = 'd2000000-0000-4000-8000-000000000001' returning id $$,
  'the workspace''s super admin cannot delete it through the API');
set local request.jwt.claims to '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is_empty($$ delete from public.workspaces where id = 'd2000000-0000-4000-8000-000000000001' returning id $$,
  'nor can an admin');
set local request.jwt.claims to '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is_empty($$ delete from public.workspaces where id = 'd2000000-0000-4000-8000-000000000001' returning id $$,
  'nor an individual');
set local request.jwt.claims to '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ update public.workspaces set name = 'W renamed' where id = 'd2000000-0000-4000-8000-000000000001' $$,
  'the super admin still manages the workspace otherwise');
reset role;
set local request.jwt.claims to '';
select ok((select (select count(*) from public.activity_logs where workspace_id = 'd2000000-0000-4000-8000-000000000001') >= b.logs
              and (select count(*) from public.daily_reports where workspace_id = 'd2000000-0000-4000-8000-000000000001') = b.reports
           from before_counts b),
  'its audit entries and reports are intact');
select is((select name from public.workspaces where id = 'd2000000-0000-4000-8000-000000000001'), 'W renamed', 'the workspace still exists');

-- A deliberate deletion without a user (service role / SQL editor) still works.
select lives_ok($$ delete from public.workspaces where id = 'd2000000-0000-4000-8000-000000000001' $$,
  'a trusted deletion still cascades as before');

select * from finish();
rollback;
