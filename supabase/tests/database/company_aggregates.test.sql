-- Company-wide task aggregates for the Super Admin dashboard (053): proves
-- the four RPCs reproduce src/lib/super-admin-overview.ts's pure functions
-- exactly, including the subtle cases found while designing them -- an
-- inactive assignee's tasks still count company-wide but not per-employee/
-- department, a cancelled-only project still gets a real last_update with
-- zero counts, and SUPER_ADMIN/OPERATIONAL_MANAGER/an unrelated workspace
-- member see correspondingly different results under RLS. Run with:
-- npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixtures.
--   Users:   sa (SUPER_ADMIN), om (OPERATIONAL_MANAGER, member of nothing),
--            adm1/adm2/outsider (ADMIN, each creates one workspace),
--            u1 "Asha" / u2 "Bala" (both team Design, active),
--            u3 (no team, full_name null, email used as its display fallback),
--            off "Dev" (team Design, assigned a task while active, then
--            deactivated -- its task must still count company-wide but not
--            per-employee/per-department).
--   Workspaces: ws1, ws2 (both scoped together in most assertions), ws3
--            (held out, to prove workspace_ids actually scopes the result).
--   Projects: p1 (the main mixed scenario), p_empty (zero tasks of any
--            kind), p_fallback (one task, to test the full_name/email/
--            "Unknown" fallback chain without any array-ordering ambiguity),
--            p_cancelled_only (ws2; one cancelled, in-range task -- the
--            last_update-subset case), p_ws3 (ws3; the isolation case).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('ec000000-0000-4000-8000-000000000001', 'sa@agg.test', '{"full_name":"SA"}'),
  ('ec000000-0000-4000-8000-000000000002', 'om@agg.test', '{"full_name":"OM"}'),
  ('ec000000-0000-4000-8000-000000000003', 'adm1@agg.test', '{"full_name":"ADM1"}'),
  ('ec000000-0000-4000-8000-000000000004', 'adm2@agg.test', '{"full_name":"ADM2"}'),
  ('ec000000-0000-4000-8000-000000000005', 'outsider@agg.test', '{"full_name":"OUTSIDER"}'),
  ('ec000000-0000-4000-8000-000000000006', 'u1@agg.test', '{"full_name":"Asha"}'),
  ('ec000000-0000-4000-8000-000000000007', 'u2@agg.test', '{"full_name":"Bala"}'),
  ('ec000000-0000-4000-8000-000000000008', 'cara@x.test', '{}'),
  ('ec000000-0000-4000-8000-000000000009', 'off@agg.test', '{"full_name":"Dev"}');

update public.profiles set role = 'SUPER_ADMIN' where id = 'ec000000-0000-4000-8000-000000000001';
update public.profiles set role = 'OPERATIONAL_MANAGER' where id = 'ec000000-0000-4000-8000-000000000002';
update public.profiles set role = 'ADMIN' where id in (
  'ec000000-0000-4000-8000-000000000003', 'ec000000-0000-4000-8000-000000000004', 'ec000000-0000-4000-8000-000000000005', 'ec000000-0000-4000-8000-000000000007'
);
update public.profiles set team = 'Design' where id in (
  'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000007', 'ec000000-0000-4000-8000-000000000009'
);

insert into public.workspaces (id, name, created_by) values
  ('ec100000-0000-4000-8000-000000000001', 'AGG WS1', 'ec000000-0000-4000-8000-000000000003'),
  ('ec100000-0000-4000-8000-000000000002', 'AGG WS2', 'ec000000-0000-4000-8000-000000000004'),
  ('ec100000-0000-4000-8000-000000000003', 'AGG WS3', 'ec000000-0000-4000-8000-000000000005');
-- adm1/adm2/outsider are added as members automatically (add_workspace_creator).
insert into public.workspace_members (workspace_id, user_id) values
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000006'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000007'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000008'),
  ('ec100000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000009');

insert into public.projects (id, workspace_id, name, created_by) values
  ('ec200000-0000-4000-8000-000000000001', 'ec100000-0000-4000-8000-000000000001', 'P1', 'ec000000-0000-4000-8000-000000000003'),
  ('ec200000-0000-4000-8000-000000000002', 'ec100000-0000-4000-8000-000000000001', 'Empty', 'ec000000-0000-4000-8000-000000000003'),
  ('ec200000-0000-4000-8000-000000000003', 'ec100000-0000-4000-8000-000000000001', 'Fallback', 'ec000000-0000-4000-8000-000000000003'),
  ('ec200000-0000-4000-8000-000000000004', 'ec100000-0000-4000-8000-000000000002', 'CancelledOnly', 'ec000000-0000-4000-8000-000000000004'),
  ('ec200000-0000-4000-8000-000000000005', 'ec100000-0000-4000-8000-000000000003', 'WS3Only', 'ec000000-0000-4000-8000-000000000005');

-- Tasks in P1. t1 (COMPLETED) needs an explicit historical completed_at/
-- updated_at, which track_task_completion normally forces to now() --
-- disabled for this one insert only, same technique as client_reports.test.sql.
alter table public.tasks disable trigger track_task_completion;
insert into public.tasks (id, project_id, title, status, due_date, scheduled_date, completed_at, updated_at, created_by) values
  ('ec300000-0000-4000-8000-000000000001', 'ec200000-0000-4000-8000-000000000001', 'Completed shared task', 'COMPLETED',
   null, '2030-01-01', '2026-10-20 06:00+00', '2026-10-20 06:00+00', 'ec000000-0000-4000-8000-000000000003');
alter table public.tasks enable trigger track_task_completion;

insert into public.tasks (id, project_id, parent_task_id, title, status, due_date, scheduled_date, completed_at, updated_at, created_by) values
  ('ec300000-0000-4000-8000-000000000002', 'ec200000-0000-4000-8000-000000000001', null, 'In progress, scheduled in range', 'IN_PROGRESS',
   null, '2026-10-20', null, '2026-10-21 00:00+00', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000003', 'ec200000-0000-4000-8000-000000000001', null, 'Todo, overdue, all-time only', 'TODO',
   '2026-10-25', '2030-01-01', null, '2026-10-22 00:00+00', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000004', 'ec200000-0000-4000-8000-000000000001', null, 'Cancelled (latest update, excluded from counts)', 'CANCELLED',
   null, '2030-01-01', null, '2026-10-28 23:00+00', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000005', 'ec200000-0000-4000-8000-000000000001', null, 'Parent with a real subtask', 'IN_PROGRESS',
   null, '2030-01-01', null, '2026-10-19 00:00+00', 'ec000000-0000-4000-8000-000000000003'),
  -- parent_task_id set directly here (not via a later UPDATE): an UPDATE
  -- would fire set_updated_at and overwrite this row's deliberately-chosen
  -- updated_at with the real current time, corrupting the last_update test.
  ('ec300000-0000-4000-8000-000000000006', 'ec200000-0000-4000-8000-000000000001', 'ec300000-0000-4000-8000-000000000005', 'Subtask (makes its parent non-leaf)', 'TODO',
   null, '2030-01-01', null, '2026-10-19 00:00+00', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000007', 'ec200000-0000-4000-8000-000000000001', null, 'Assigned to an employee later deactivated', 'TODO',
   null, '2030-01-01', null, '2026-10-18 00:00+00', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000008', 'ec200000-0000-4000-8000-000000000001', null, 'Due in range, overdue by today', 'TODO',
   '2026-10-20', '2030-01-01', null, '2026-10-23 00:00+00', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000009', 'ec200000-0000-4000-8000-000000000003', null, 'Fallback-name task', 'TODO',
   null, '2030-01-01', null, '2026-10-15 00:00+00', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-00000000000a', 'ec200000-0000-4000-8000-000000000004', null, 'Cancelled, in range, only task in its project', 'CANCELLED',
   null, '2026-10-20', null, '2026-10-26 12:00+00', 'ec000000-0000-4000-8000-000000000004'),
  ('ec300000-0000-4000-8000-00000000000b', 'ec200000-0000-4000-8000-000000000005', null, 'WS3-only task, outside ws1/ws2 scope', 'TODO',
   null, '2030-01-01', null, '2026-10-27 00:00+00', 'ec000000-0000-4000-8000-000000000005');

-- Assignees. "off" is still active here (the insert's validity trigger
-- requires an active member); it is deactivated further down.
insert into public.task_assignees (task_id, user_id, assigned_by) values
  ('ec300000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000007', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000003', 'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000004', 'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000005', 'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000007', 'ec000000-0000-4000-8000-000000000009', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000008', 'ec000000-0000-4000-8000-000000000006', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-000000000009', 'ec000000-0000-4000-8000-000000000008', 'ec000000-0000-4000-8000-000000000003'),
  ('ec300000-0000-4000-8000-00000000000a', 'ec000000-0000-4000-8000-000000000004', 'ec000000-0000-4000-8000-000000000004'),
  ('ec300000-0000-4000-8000-00000000000b', 'ec000000-0000-4000-8000-000000000005', 'ec000000-0000-4000-8000-000000000005');

-- Deactivate "off" now that its assignment exists: a leaf task assigned only
-- to a now-inactive employee must still count company-wide, but contribute
-- to no employee/department row.
update public.profiles set is_active = false where id = 'ec000000-0000-4000-8000-000000000009';

-- Convenience: the two in-scope workspaces, and "today" for every call below.
-- (psql variables aren't available in plain SQL test files, so these are
-- repeated as literals; kept here only as a readable reference.)
-- WS1 = ec100000-0000-4000-8000-000000000001
-- WS2 = ec100000-0000-4000-8000-000000000002
-- WS3 = ec100000-0000-4000-8000-000000000003
-- TODAY = 2026-10-27

-- ===========================================================================
-- All assertions below run as SA (SUPER_ADMIN), the realistic caller
-- identity for the Super Admin dashboard -- exercising the RLS-restricted
-- path (SECURITY INVOKER), not the postgres superuser's unrestricted view.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"ec000000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 1. company_task_status_counts: leaf-task totals (CANCELLED and the
-- parent-with-a-subtask excluded; the inactive-assignee's task still counts).
-- ws1 alone: 7 leaf tasks (t1..t3, t6..t8; t4 cancelled, t5 has a child).
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select total, completed, in_progress, pending, blocked, overdue
     from public.company_task_status_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date) $$,
  $$ values (7, 1, 1, 5, 0, 2) $$,
  'company_task_status_counts: ws1 leaf totals exclude cancelled and the subtask parent'
);

-- ws1 + ws2 together: ws2 contributes zero leaf tasks (its only task is
-- cancelled), so the totals are unchanged -- proves scoping is additive, not
-- accidentally double-counting or dropping ws2's (absent) contribution.
select results_eq(
  $$ select total from public.company_task_status_counts(
       array['ec100000-0000-4000-8000-000000000001','ec100000-0000-4000-8000-000000000002']::uuid[], '2026-10-27'::date) $$,
  $$ values (7) $$,
  'company_task_status_counts: ws2 adds nothing (its only task is cancelled)'
);

-- ws3 in isolation: only its own task, proving ws1/ws2 data does not leak in
-- when they are left out of p_workspace_ids.
select results_eq(
  $$ select total, completed, pending from public.company_task_status_counts(array['ec100000-0000-4000-8000-000000000003']::uuid[], '2026-10-27'::date) $$,
  $$ values (1, 0, 1) $$,
  'company_task_status_counts: workspace_ids actually scopes the result (ws3 alone)'
);

-- ---------------------------------------------------------------------------
-- 2. company_employee_task_counts (no range): per active, non-super-admin
-- employee; the inactive "off" gets no row despite having a real task.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select total, completed, in_progress, pending, overdue
     from public.company_employee_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata')
     where user_id = 'ec000000-0000-4000-8000-000000000006' $$,
  $$ values (5, 1, 1, 3, 2) $$,
  'company_employee_task_counts: u1 (Asha) all-time'
);
select results_eq(
  $$ select total, completed from public.company_employee_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata')
     where user_id = 'ec000000-0000-4000-8000-000000000007' $$,
  $$ values (1, 1) $$,
  'company_employee_task_counts: u2 (Bala) shares the completed task with u1'
);
select is_empty(
  $$ select 1 from public.company_employee_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata')
     where user_id = 'ec000000-0000-4000-8000-000000000009' $$,
  'company_employee_task_counts: the now-inactive "off" gets no row, even though it has a real task'
);

-- ---------------------------------------------------------------------------
-- 3. company_employee_task_counts with a date range -- the three OR branches
-- of inDateRange (completed_at local day / scheduled_date / due_date), and
-- overdue still measured against p_today, not the range bounds.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select total, completed, in_progress, pending, overdue
     from public.company_employee_task_counts(
       array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata', '2026-10-19'::date, '2026-10-21'::date)
     where user_id = 'ec000000-0000-4000-8000-000000000006' $$,
  $$ values (3, 1, 1, 1, 1) $$,
  'company_employee_task_counts: u1 in range 10-19..10-21 matches via completed_at (t1), scheduled_date (t2) and due_date (t8); overdue still uses p_today'
);
select is_empty(
  $$ select 1 from public.company_employee_task_counts(
       array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata', '2026-10-19'::date, '2026-10-21'::date)
     where user_id = 'ec000000-0000-4000-8000-000000000008' $$,
  'company_employee_task_counts: u3''s only task falls outside the range, so it gets no row (not a zero row)'
);

-- ---------------------------------------------------------------------------
-- 4. company_department_task_counts: a task shared by u1 and u2 (same
-- department) counts once; the inactive "off" (also "Design") contributes
-- nothing; u3 (no team) forms its own "No department" row.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select department, total, completed from public.company_department_task_counts(
       array['ec100000-0000-4000-8000-000000000001']::uuid[], 'Asia/Kolkata') order by department $$,
  $$ values ('Design'::text, 5, 1), ('No department'::text, 1, 0) $$,
  'company_department_task_counts: Design counts the shared task once and excludes the inactive assignee; No department is u3 alone'
);
select is_empty(
  $$ select 1 from public.company_department_task_counts(
       array['ec100000-0000-4000-8000-000000000001']::uuid[], 'Asia/Kolkata', '2026-10-19'::date, '2026-10-21'::date)
     where department = 'No department' $$,
  'company_department_task_counts: "No department" has nothing in range (u3''s task is out of range), so it gets no row'
);

-- ---------------------------------------------------------------------------
-- 5. company_project_task_counts (no range):
--    - P1: counts/next_due/assignees from the 6 leaf tasks, but last_update
--      from the CANCELLED task's timestamp (2026-10-28 23:00), the latest in
--      the project -- the lastUpdate-subset case, inside an otherwise normal
--      project.
--    - Fallback: a single assignee with no full_name, falling back to email.
--    - Empty: zero tasks of any kind -> no row at all (sparse).
--    - CancelledOnly (ws2): zero leaf tasks but a real last_update -- the
--      starkest version of the same case, isolated.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select total, completed, in_progress, pending, overdue, next_due, last_update, assignees
     from public.company_project_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata')
     where project_id = 'ec200000-0000-4000-8000-000000000001' $$,
  $$ values (6, 1, 1, 4, 2, '2026-10-20'::date, '2026-10-28 23:00+00'::timestamptz, array['Asha','Bala','Dev']) $$,
  'company_project_task_counts: P1 -- last_update comes from the cancelled task even though it is excluded from every other column'
);
select results_eq(
  $$ select total, assignees from public.company_project_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata')
     where project_id = 'ec200000-0000-4000-8000-000000000003' $$,
  $$ values (1, array['cara@x.test']) $$,
  'company_project_task_counts: Fallback -- no full_name falls back to email'
);
select is_empty(
  $$ select 1 from public.company_project_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata')
     where project_id = 'ec200000-0000-4000-8000-000000000002' $$,
  'company_project_task_counts: Empty gets no row at all (zero tasks of any kind) -- the caller defaults it to zero'
);
select results_eq(
  $$ select total, completed, next_due, last_update, assignees
     from public.company_project_task_counts(array['ec100000-0000-4000-8000-000000000002']::uuid[], '2026-10-27'::date, 'Asia/Kolkata')
     where project_id = 'ec200000-0000-4000-8000-000000000004' $$,
  $$ values (0, 0, null::date, '2026-10-26 12:00+00'::timestamptz, '{}'::text[]) $$,
  'company_project_task_counts: CancelledOnly -- zero counts, but a real last_update (its only task is cancelled)'
);

-- ===========================================================================
-- RLS: an Operational Manager (not a member of ws1) sees the same figures as
-- SA, through a different policy branch (accessible_task_ids()'s OM union).
-- ===========================================================================
set local request.jwt.claims to '{"sub":"ec000000-0000-4000-8000-000000000002","role":"authenticated"}';
select results_eq(
  $$ select total, completed, in_progress, pending, blocked, overdue
     from public.company_task_status_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date) $$,
  $$ values (7, 1, 1, 5, 0, 2) $$,
  'RLS: an Operational Manager (no ws1 membership) sees the same company-wide totals as SA'
);
select results_eq(
  $$ select total from public.company_employee_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata')
     where user_id = 'ec000000-0000-4000-8000-000000000006' $$,
  $$ values (5) $$,
  'RLS: an Operational Manager sees u1''s full per-employee total too'
);

-- ===========================================================================
-- RLS: an ordinary Admin who is not a member of ws1/ws2 (and is neither
-- SUPER_ADMIN nor OPERATIONAL_MANAGER) sees nothing for them -- RLS narrows
-- transparently to zero rows / an all-zero row, never an error.
-- ===========================================================================
set local request.jwt.claims to '{"sub":"ec000000-0000-4000-8000-000000000005","role":"authenticated"}';
select results_eq(
  $$ select total, completed, in_progress, pending, blocked, overdue
     from public.company_task_status_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date) $$,
  $$ values (0, 0, 0, 0, 0, 0) $$,
  'RLS: an unrelated Admin (outsider) gets an all-zero row for a workspace it cannot see, not an error'
);
select is_empty(
  $$ select 1 from public.company_employee_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata') $$,
  'RLS: an unrelated Admin gets no employee rows for a workspace it cannot see'
);
select is_empty(
  $$ select 1 from public.company_project_task_counts(array['ec100000-0000-4000-8000-000000000001']::uuid[], '2026-10-27'::date, 'Asia/Kolkata') $$,
  'RLS: an unrelated Admin gets no project rows for a workspace it cannot see'
);
-- The outsider *can* see its own ws3, proving the zero rows above are RLS
-- narrowing by workspace, not a broken/always-empty function.
select results_eq(
  $$ select total from public.company_task_status_counts(array['ec100000-0000-4000-8000-000000000003']::uuid[], '2026-10-27'::date) $$,
  $$ values (1) $$,
  'RLS: the same outsider sees its own ws3 fine'
);

reset role;
set local request.jwt.claims to '';

select * from finish();
rollback;
