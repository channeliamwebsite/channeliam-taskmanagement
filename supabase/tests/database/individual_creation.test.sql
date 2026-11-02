-- Migration 028: Individuals create clients and projects only with the
-- default-off can_create_clients_projects grant, given and taken back by a
-- super admin (audited). Without it, or in another workspace, they cannot.
-- Admin rules and the existing can_create_projects flag are unchanged.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres)
--   ok = individual in W1 (granted below)    no = individual in W1, never granted
--   ad = admin in W1 without can_create_projects    sa = super admin (no membership)
insert into auth.users (id, email, raw_user_meta_data) values
  ('d7000000-0000-4000-8000-000000000001', 'ok@ic.test', '{"full_name":"OK"}'),
  ('d7000000-0000-4000-8000-000000000002', 'no@ic.test', '{"full_name":"NO"}'),
  ('d7000000-0000-4000-8000-000000000003', 'ad@ic.test', '{"full_name":"AD"}'),
  ('d7000000-0000-4000-8000-000000000004', 'sa@ic.test', '{"full_name":"SA"}');
update public.profiles set role = 'ADMIN' where id = 'd7000000-0000-4000-8000-000000000003';
update public.profiles set role = 'SUPER_ADMIN' where id = 'd7000000-0000-4000-8000-000000000004';
insert into public.workspaces (id, name, created_by) values
  ('d8000000-0000-4000-8000-000000000001', 'IC One', 'd7000000-0000-4000-8000-000000000004'),
  ('d8000000-0000-4000-8000-000000000002', 'IC Two', 'd7000000-0000-4000-8000-000000000004');
-- Memberships use the column defaults, as the app does.
insert into public.workspace_members (workspace_id, user_id) values
  ('d8000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000001'),
  ('d8000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000002');
insert into public.workspace_members (workspace_id, user_id, can_create_projects) values
  ('d8000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000003', false);
insert into public.clients (id, workspace_id, name) values
  ('d9000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 'Existing client'),
  ('d9000000-0000-4000-8000-000000000002', 'd8000000-0000-4000-8000-000000000002', 'Other workspace client');

select is((select count(*)::int from public.workspace_members where can_create_clients_projects), 0,
  'no membership holds the new grant after the migration (nothing silently broadened)');
select is((select format('%s|%s', can_create_projects, can_create_clients_projects) from public.workspace_members
           where user_id = 'd7000000-0000-4000-8000-000000000001'),
  't|f', 'a new member gets the old flag''s default but not the new grant (default off)');

set local role authenticated;

-- Default deny: a new Individual cannot create clients or projects
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000001', 'Too early', 'd7000000-0000-4000-8000-000000000001')
$$, '42501', null, 'without the grant an individual cannot create clients');
select throws_ok($$
  insert into public.projects (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000001', 'Too early', 'd7000000-0000-4000-8000-000000000001')
$$, '42501', null, 'without the grant an individual cannot create projects (can_create_projects alone is not enough)');
update public.workspace_members set can_create_clients_projects = true
  where workspace_id = 'd8000000-0000-4000-8000-000000000001' and user_id = 'd7000000-0000-4000-8000-000000000001';

-- Only a super admin grants it
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000003","role":"authenticated"}';
update public.workspace_members set can_create_clients_projects = true
  where workspace_id = 'd8000000-0000-4000-8000-000000000001' and user_id = 'd7000000-0000-4000-8000-000000000001';
reset role;
set local request.jwt.claims to '';
select is((select count(*)::int from public.workspace_members where can_create_clients_projects), 0,
  'neither the individual nor an admin can grant it');
set local role authenticated;
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000004","role":"authenticated"}';
select results_eq($$
  update public.workspace_members set can_create_clients_projects = true
  where workspace_id = 'd8000000-0000-4000-8000-000000000001' and user_id = 'd7000000-0000-4000-8000-000000000001'
  returning user_id::text
$$, $$ values ('d7000000-0000-4000-8000-000000000001'::text) $$, 'a super admin (not a member) grants it');

-- With the grant
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$
  insert into public.clients (id, workspace_id, name, created_by)
  values ('d9000000-0000-4000-8000-000000000011', 'd8000000-0000-4000-8000-000000000001', 'My client', 'd7000000-0000-4000-8000-000000000001')
$$, 'with the grant an individual creates a client');
select lives_ok($$
  insert into public.projects (id, workspace_id, name, client_id, created_by)
  values ('da000000-0000-4000-8000-000000000011', 'd8000000-0000-4000-8000-000000000001', 'My project',
          'd9000000-0000-4000-8000-000000000011', 'd7000000-0000-4000-8000-000000000001')
$$, 'with the grant an individual creates a project');
select lives_ok($$
  insert into public.projects (workspace_id, name, client_id, created_by)
  values ('d8000000-0000-4000-8000-000000000001', 'For existing client', 'd9000000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000001')
$$, 'and a project for an existing client of the workspace');
select lives_ok($$
  select public.create_task('da000000-0000-4000-8000-000000000011', 'My own task', array['d7000000-0000-4000-8000-000000000001']::uuid[])
$$, 'and adds their own task to it');
select throws_ok($$
  select public.create_task('da000000-0000-4000-8000-000000000011', 'For someone else', array['d7000000-0000-4000-8000-000000000002']::uuid[])
$$, null, null, 'but still cannot assign work to someone else');
update public.clients set notes = 'Mine' where id = 'd9000000-0000-4000-8000-000000000011';
update public.projects set description = 'Mine' where id = 'da000000-0000-4000-8000-000000000011';
update public.clients set notes = 'Not mine' where id = 'd9000000-0000-4000-8000-000000000001';
select throws_ok($$
  insert into public.projects (workspace_id, name, owner_id, created_by)
  values ('d8000000-0000-4000-8000-000000000001', 'Owned by another', 'd7000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000001')
$$, '42501', null, 'an individual cannot make someone else the owner of a new project');
select throws_ok($$ update public.projects set owner_id = 'd7000000-0000-4000-8000-000000000003' where id = 'da000000-0000-4000-8000-000000000011' $$,
  '42501', null, 'nor hand an existing project to someone else');
select throws_ok($$ update public.projects set status = 'ARCHIVED' where id = 'da000000-0000-4000-8000-000000000011' $$,
  '42501', null, 'an individual cannot archive a project');
delete from public.clients where id = 'd9000000-0000-4000-8000-000000000011';
delete from public.projects where id = 'da000000-0000-4000-8000-000000000011';
-- Workspace isolation
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000002', 'Elsewhere', 'd7000000-0000-4000-8000-000000000001')
$$, '42501', null, 'the grant does not apply in a workspace they are not a member of (clients)');
select throws_ok($$
  insert into public.projects (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000002', 'Elsewhere', 'd7000000-0000-4000-8000-000000000001')
$$, '42501', null, 'nor for projects');
select throws_ok($$
  insert into public.projects (workspace_id, name, client_id, created_by)
  values ('d8000000-0000-4000-8000-000000000001', 'Wrong client', 'd9000000-0000-4000-8000-000000000002', 'd7000000-0000-4000-8000-000000000001')
$$, '23514', null, 'a project cannot use a client of another workspace');
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000001', 'Spoofed', 'd7000000-0000-4000-8000-000000000002')
$$, '42501', null, 'a client cannot be created in someone else''s name');

-- A colleague without the grant
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000001', 'No grant', 'd7000000-0000-4000-8000-000000000002')
$$, '42501', null, 'a colleague without the grant still cannot create clients');
update public.clients set notes = 'Hijack' where id = 'd9000000-0000-4000-8000-000000000011';

-- Admin without can_create_projects: unchanged (clients yes, projects no); the new grant does not apply to admins
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000004","role":"authenticated"}';
update public.workspace_members set can_create_clients_projects = true
  where workspace_id = 'd8000000-0000-4000-8000-000000000001' and user_id = 'd7000000-0000-4000-8000-000000000003';
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$
  insert into public.clients (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000001', 'Admin client', 'd7000000-0000-4000-8000-000000000003')
$$, 'an admin still creates clients (unchanged)');
select throws_ok($$
  insert into public.projects (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000001', 'Admin project', 'd7000000-0000-4000-8000-000000000003')
$$, '42501', null, 'an admin without can_create_projects still cannot create projects, even holding the individual grant');

-- Revocation
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000004","role":"authenticated"}';
update public.workspace_members set can_create_clients_projects = false
  where workspace_id = 'd8000000-0000-4000-8000-000000000001' and user_id = 'd7000000-0000-4000-8000-000000000001';
set local request.jwt.claims to '{"sub":"d7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000001', 'After revoke', 'd7000000-0000-4000-8000-000000000001')
$$, '42501', null, 'after revocation the individual cannot create clients');
select throws_ok($$
  insert into public.projects (workspace_id, name, created_by) values ('d8000000-0000-4000-8000-000000000001', 'After revoke', 'd7000000-0000-4000-8000-000000000001')
$$, '42501', null, 'or projects');
select is((select count(*)::int from public.projects where id = 'da000000-0000-4000-8000-000000000011'), 1,
  'what they created before is kept');

reset role;
set local request.jwt.claims to '';
select is((select format('%s|%s|%s',
    (select notes from public.clients where id = 'd9000000-0000-4000-8000-000000000011'),
    (select description from public.projects where id = 'da000000-0000-4000-8000-000000000011'),
    coalesce((select notes from public.clients where id = 'd9000000-0000-4000-8000-000000000001'), '-'))),
  'Mine|Mine|-', 'they edit only what they created; colleagues cannot edit it');
select is((select count(*)::int from public.clients where id = 'd9000000-0000-4000-8000-000000000011'), 1,
  'individuals cannot delete clients or projects');
select is((select count(*)::int from public.activity_logs
           where action = 'MEMBER_PERMISSION_CHANGED' and target_user_id = 'd7000000-0000-4000-8000-000000000001'
             and user_id = 'd7000000-0000-4000-8000-000000000004'
             and (new_value ? 'can_create_clients_projects')), 2,
  'the grant and the revocation are audited with the super admin as actor');
select is((select count(*)::int from public.activity_logs
           where action = 'CLIENT_CREATED' and user_id = 'd7000000-0000-4000-8000-000000000001'), 1,
  'an individual''s client creation is audited');

select * from finish();
rollback;
