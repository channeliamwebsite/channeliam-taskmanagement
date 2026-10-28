-- Access-control tests for clients, notifications, workspace settings, daily
-- reports and deactivated users. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres): two workspaces, sa = super admin of W1, ad = admin,
-- iv = individual, ot = super admin of W2 only.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111', 'sa@access.test', '{"full_name":"SA"}'),
  ('a2222222-2222-2222-2222-222222222222', 'ad@access.test', '{"full_name":"AD"}'),
  ('a3333333-3333-3333-3333-333333333333', 'iv@access.test', '{"full_name":"IV"}'),
  ('a4444444-4444-4444-4444-444444444444', 'ot@access.test', '{"full_name":"OT"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('a1111111-1111-1111-1111-111111111111', 'a4444444-4444-4444-4444-444444444444');
update public.profiles set role = 'ADMIN' where id = 'a2222222-2222-2222-2222-222222222222';

insert into public.workspaces (id, name, created_by) values
  ('f1000000-0000-0000-0000-000000000001', 'W1', 'a1111111-1111-1111-1111-111111111111'),
  ('f2000000-0000-0000-0000-000000000002', 'W2', 'a4444444-4444-4444-4444-444444444444');
insert into public.workspace_members (workspace_id, user_id, can_create_projects) values
  ('f1000000-0000-0000-0000-000000000001', 'a2222222-2222-2222-2222-222222222222', true),
  ('f1000000-0000-0000-0000-000000000001', 'a3333333-3333-3333-3333-333333333333', false);
insert into public.clients (id, workspace_id, name, contact_email, created_by) values
  ('c1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Client One', 'one@client.test', 'a1111111-1111-1111-1111-111111111111'),
  ('c2000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000002', 'Client Two', 'two@client.test', 'a4444444-4444-4444-4444-444444444444');
insert into public.notifications (user_id, type, title) values
  ('a3333333-3333-3333-3333-333333333333', 'SYSTEM', 'for iv'),
  ('a2222222-2222-2222-2222-222222222222', 'SYSTEM', 'for ad');

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.clients), 1, 'member sees only clients of own workspace');
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'Sneaky', 'a3333333-3333-3333-3333-333333333333')
$$, '42501', null, 'individual cannot create clients');
update public.clients set name = 'Renamed' where id = 'c1000000-0000-0000-0000-000000000001';
select is((select name from public.clients where id = 'c1000000-0000-0000-0000-000000000001'), 'Client One',
          'individual cannot rename clients (update filtered by RLS)');

set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select lives_ok($$
  insert into public.clients (workspace_id, name, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'Admin Client', 'a2222222-2222-2222-2222-222222222222')
$$, 'admin can create clients in own workspace');
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by)
  values ('f2000000-0000-0000-0000-000000000002', 'Foreign', 'a2222222-2222-2222-2222-222222222222')
$$, '42501', null, 'admin cannot create clients in another workspace');
select throws_ok($$
  insert into public.projects (workspace_id, name, client_id, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'Cross link', 'c2000000-0000-0000-0000-000000000002',
          'a2222222-2222-2222-2222-222222222222')
$$, '23514', 'Client must belong to the same workspace', 'project cannot reference another workspace''s client');
select throws_ok($$
  insert into public.projects (workspace_id, name, client_id, created_by)
  values ('f2000000-0000-0000-0000-000000000002', 'Foreign workspace', 'c2000000-0000-0000-0000-000000000002',
          'a2222222-2222-2222-2222-222222222222')
$$, '42501', null, 'permitted admin cannot add a project to another workspace''s client');
-- Adding a project from a client's page (client preselected).
select lives_ok($$
  insert into public.projects (workspace_id, name, client_id, client_name, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'Client page project', 'c1000000-0000-0000-0000-000000000001', 'Client One',
          'a2222222-2222-2222-2222-222222222222')
$$, 'permitted admin adds a project to a client of own workspace');
select is((select client_id from public.projects where name = 'Client page project'), 'c1000000-0000-0000-0000-000000000001'::uuid,
          'the new project belongs to that client');
set local request.jwt.claims to '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok($$
  insert into public.projects (workspace_id, name, client_id, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'Individual project', 'c1000000-0000-0000-0000-000000000001',
          'a3333333-3333-3333-3333-333333333333')
$$, '42501', null, 'individual cannot add a project to a client');
set local request.jwt.claims to '{"sub":"a4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$
  insert into public.projects (workspace_id, name, client_id, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'Foreign project', 'c1000000-0000-0000-0000-000000000001',
          'a4444444-4444-4444-4444-444444444444')
$$, '42501', null, 'another workspace''s super admin cannot add a project to this client');
set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';
delete from public.clients where id = 'c1000000-0000-0000-0000-000000000001';
reset role;
select is((select count(*)::int from public.clients where id = 'c1000000-0000-0000-0000-000000000001'), 1,
          'admin delete of a client is filtered (super admin only)');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Notifications privacy
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.notifications), 1, 'user sees only own notifications');
update public.notifications set is_read = true where title = 'for ad';
reset role;
select is((select is_read from public.notifications where title = 'for ad'), false,
          'user cannot mark someone else''s notification read');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
update public.notifications set is_read = true where title = 'for iv';
reset role;
select ok((select is_read and read_at is not null from public.notifications where title = 'for iv'),
          'own notification marked read; read_at recorded');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok($$
  update public.notifications set user_id = 'a2222222-2222-2222-2222-222222222222' where title = 'for iv'
$$, '42501', null, 'notification recipient cannot be changed (column not updatable)');

-- ---------------------------------------------------------------------------
-- Workspace settings (timezone)
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';
update public.workspaces set timezone = 'UTC' where id = 'f1000000-0000-0000-0000-000000000001';
reset role;
select is((select timezone from public.workspaces where id = 'f1000000-0000-0000-0000-000000000001'), 'Asia/Kolkata',
          'admin cannot change workspace timezone; default is Asia/Kolkata');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
update public.workspaces set timezone = 'Asia/Dubai' where id = 'f1000000-0000-0000-0000-000000000001';
reset role;
select is((select timezone from public.workspaces where id = 'f1000000-0000-0000-0000-000000000001'), 'Asia/Dubai',
          'super admin can change workspace timezone');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a4444444-4444-4444-4444-444444444444","role":"authenticated"}';
update public.workspaces set timezone = 'UTC' where id = 'f1000000-0000-0000-0000-000000000001';
reset role;
select is((select timezone from public.workspaces where id = 'f1000000-0000-0000-0000-000000000001'), 'Asia/Dubai',
          'super admin of another workspace cannot change it');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Daily reports
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select lives_ok($$
  select public.submit_evening_report('f1000000-0000-0000-0000-000000000001', 0, 'Done')
$$, 'member submits own report');
select throws_ok($$
  insert into public.daily_reports (user_id, workspace_id, report_date)
  values ('a2222222-2222-2222-2222-222222222222', 'f1000000-0000-0000-0000-000000000001', '2026-10-12')
$$, '42501', null, 'cannot write a report row directly (e.g. as someone else)');
select throws_ok($$
  select public.submit_evening_report('f2000000-0000-0000-0000-000000000002', 0, 'Done')
$$, '42501', null, 'cannot submit a report into a workspace you are not in');
select lives_ok($$
  select public.submit_evening_report('f1000000-0000-0000-0000-000000000001', 0, 'Done again')
$$, 'resubmitting the same day updates the report');
select is((select count(*)::int from public.daily_reports where user_id = 'a3333333-3333-3333-3333-333333333333'), 1,
          'one report per user per workspace per day');

set local request.jwt.claims to '{"sub":"a4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports), 0, 'super admin of another workspace cannot read W1 reports');
set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports), 1, 'admin of the workspace can read team reports');

-- ---------------------------------------------------------------------------
-- Deactivated users and self-escalation
-- ---------------------------------------------------------------------------
reset role;
set local request.jwt.claims to '';
update public.profiles set is_active = false where id = 'a2222222-2222-2222-2222-222222222222';
set local role authenticated;
set local request.jwt.claims to '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.clients), 0, 'deactivated user reads nothing');
select throws_ok($$
  insert into public.clients (workspace_id, name, created_by)
  values ('f1000000-0000-0000-0000-000000000001', 'After deactivation', 'a2222222-2222-2222-2222-222222222222')
$$, '42501', null, 'deactivated user cannot write');

set local request.jwt.claims to '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok($$
  update public.profiles set role = 'SUPER_ADMIN' where id = 'a3333333-3333-3333-3333-333333333333'
$$, '42501', null, 'individual cannot promote themselves');
select throws_ok($$
  update public.profiles set id = 'a9999999-9999-9999-9999-999999999999' where id = 'a3333333-3333-3333-3333-333333333333'
$$, '42501', null, 'profile id is not updatable');

select * from finish();
rollback;
