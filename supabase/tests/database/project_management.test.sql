-- Admin project creation and editing (migration 020), with the earlier
-- protections (014, 018, 019) still in force. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres, no user). W1: sa, ad (membership with the default
-- flag), adr (restricted: flag explicitly off), iv. W2: sa2, ad3.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a5000000-0000-4000-8000-000000000001', 'sa@pm.test', '{"full_name":"SA"}'),
  ('a5000000-0000-4000-8000-000000000002', 'ad@pm.test', '{"full_name":"AD"}'),
  ('a5000000-0000-4000-8000-000000000003', 'adr@pm.test', '{"full_name":"ADR"}'),
  ('a5000000-0000-4000-8000-000000000004', 'iv@pm.test', '{"full_name":"IV"}'),
  ('a5000000-0000-4000-8000-000000000005', 'sa2@pm.test', '{"full_name":"SA2"}'),
  ('a5000000-0000-4000-8000-000000000006', 'ad3@pm.test', '{"full_name":"AD3"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('a5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000005');
update public.profiles set role = 'ADMIN' where id in ('a5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-000000000006');
insert into public.workspaces (id, name, created_by) values
  ('a6000000-0000-4000-8000-000000000001', 'W1', 'a5000000-0000-4000-8000-000000000001'),
  ('a6000000-0000-4000-8000-000000000002', 'W2', 'a5000000-0000-4000-8000-000000000005');
insert into public.workspace_members (workspace_id, user_id) values
  ('a6000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000002'),
  ('a6000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000004'),
  ('a6000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000006');
insert into public.workspace_members (workspace_id, user_id, can_create_projects) values
  ('a6000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000003', false);
insert into public.clients (id, workspace_id, name, created_by) values
  ('a7000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'Acme', 'a5000000-0000-4000-8000-000000000001'),
  ('a7000000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000002', 'Other company', 'a5000000-0000-4000-8000-000000000005');
-- P1: created by the super admin, no owner. P2: created by the super admin, owned by adr.
insert into public.projects (id, workspace_id, name, client_id, created_by, owner_id) values
  ('a8000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'SA project', 'a7000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', null),
  ('a8000000-0000-4000-8000-000000000002', 'a6000000-0000-4000-8000-000000000001', 'Owned by ADR', 'a7000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000003'),
  ('a8000000-0000-4000-8000-000000000003', 'a6000000-0000-4000-8000-000000000002', 'W2 project', 'a7000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000005', null);
insert into public.tasks (id, project_id, title, created_by) values
  ('a9000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'SA task', 'a5000000-0000-4000-8000-000000000001');

select is((select can_create_projects from public.workspace_members
           where workspace_id = 'a6000000-0000-4000-8000-000000000001' and user_id = 'a5000000-0000-4000-8000-000000000002'), true,
  'a new membership can create projects by default');

-- ---------------------------------------------------------------------------
-- Creation
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$
  insert into public.projects (workspace_id, name, client_id) values
    ('a6000000-0000-4000-8000-000000000001', 'AD project', 'a7000000-0000-4000-8000-000000000001')
$$, 'an admin creates a project in their workspace by default');
select throws_ok($$ insert into public.projects (workspace_id, name) values ('a6000000-0000-4000-8000-000000000002', 'Into W2') $$,
  '42501', null, 'but not in another workspace');
select throws_ok($$
  insert into public.projects (workspace_id, name, client_id) values
    ('a6000000-0000-4000-8000-000000000001', 'Foreign client', 'a7000000-0000-4000-8000-000000000002')
$$, '23514', null, 'nor for another workspace''s client');
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok($$ insert into public.projects (workspace_id, name) values ('a6000000-0000-4000-8000-000000000001', 'ADR project') $$,
  '42501', null, 'a restricted admin cannot create projects');
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ insert into public.projects (workspace_id, name) values ('a6000000-0000-4000-8000-000000000001', 'IV project') $$,
  '42501', null, 'an individual cannot create projects');

-- The super admin restricts ad; the restriction is respected, then lifted.
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.workspace_members set can_create_projects = false
where workspace_id = 'a6000000-0000-4000-8000-000000000001' and user_id = 'a5000000-0000-4000-8000-000000000002';
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$ insert into public.projects (workspace_id, name) values ('a6000000-0000-4000-8000-000000000001', 'While restricted') $$,
  '42501', null, 'after the super admin restricts the admin, creation is refused');
select is_empty($$ update public.projects set name = 'Renamed while restricted' where id = 'a8000000-0000-4000-8000-000000000001' returning id $$,
  'and editing the super admin''s project is refused too');
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000003","role":"authenticated"}';
update public.workspace_members set can_create_projects = true
where workspace_id = 'a6000000-0000-4000-8000-000000000001' and user_id = 'a5000000-0000-4000-8000-000000000003';
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
update public.workspace_members set can_create_projects = true
where workspace_id = 'a6000000-0000-4000-8000-000000000001' and user_id = 'a5000000-0000-4000-8000-000000000002';
reset role;
set local request.jwt.claims to '';
select is((select can_create_projects from public.workspace_members
           where workspace_id = 'a6000000-0000-4000-8000-000000000001' and user_id = 'a5000000-0000-4000-8000-000000000003'), false,
  'an admin cannot lift their own restriction');

-- ---------------------------------------------------------------------------
-- Editing
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000002","role":"authenticated"}';
select results_eq($$ update public.projects set name = 'SA project v2', due_date = '2026-12-31'
                     where id = 'a8000000-0000-4000-8000-000000000001' returning name $$,
  $$ values ('SA project v2'::text) $$, 'an admin edits a project a super admin created');
select is_empty($$ update public.projects set name = 'Renamed General'
                   where workspace_id = 'a6000000-0000-4000-8000-000000000001' and is_default returning id $$,
  'but not the General project');
select is_empty($$ update public.projects set name = 'Hacked' where id = 'a8000000-0000-4000-8000-000000000003' returning id $$,
  'nor a project of another workspace');
select throws_ok($$ update public.projects set client_id = 'a7000000-0000-4000-8000-000000000002' where id = 'a8000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'nor attach another workspace''s client');
select is_empty($$ delete from public.projects where id = 'a8000000-0000-4000-8000-000000000001' returning id $$,
  'admins still cannot delete projects');

set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is_empty($$ update public.projects set name = 'ADR renames' where id = 'a8000000-0000-4000-8000-000000000001' returning id $$,
  'a restricted admin cannot edit others'' projects');
select results_eq($$ update public.projects set priority = 'HIGH' where id = 'a8000000-0000-4000-8000-000000000002' returning priority::text $$,
  $$ values ('HIGH'::text) $$, 'a restricted admin still edits the project they own');

set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is_empty($$ update public.projects set name = 'IV renames' where id = 'a8000000-0000-4000-8000-000000000001' returning id $$,
  'an individual cannot edit projects');
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000006","role":"authenticated"}';
select is_empty($$ update public.projects set name = 'AD3 renames' where id = 'a8000000-0000-4000-8000-000000000001' returning id $$,
  'another workspace''s admin cannot edit it');
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$ update public.projects set status = 'ACTIVE' where id = 'a8000000-0000-4000-8000-000000000001' returning status::text $$,
  $$ values ('ACTIVE'::text) $$, 'the super admin still edits every project');

-- ---------------------------------------------------------------------------
-- Earlier protections still hold
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a5000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$
  select public.create_task('a8000000-0000-4000-8000-000000000001', 'Sneaky subtask', array['a5000000-0000-4000-8000-000000000002']::uuid[],
    null, 'a9000000-0000-4000-8000-000000000001')
$$, '42501', 'You can only add subtasks to tasks you manage.', 'editing a project does not let an admin nest under its tasks (018)');
select throws_ok($$ delete from public.clients where id = 'a7000000-0000-4000-8000-000000000001' $$,
  '23503', null, 'a client that still has projects cannot be deleted (014)');
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.projects where workspace_id = 'a6000000-0000-4000-8000-000000000002' and name = 'W2 project'), 1,
  'the other workspace''s project is untouched');

select * from finish();
rollback;
