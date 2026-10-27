-- =============================================================================
-- PRODUCTION FRESH-START CLEANUP — TEMPLATE. DO NOT RUN UNTIL THE LISTS BELOW
-- HAVE BEEN FILLED FROM production_data_audit.sql AND APPROVED.
--
-- * Deletes ONLY the ids pasted into the approved_* lists (no name patterns,
--   no TRUNCATE, no schema/migration/RLS/trigger/settings/auth changes).
-- * Never deletes profiles, auth users, workspaces or workspace memberships.
-- * Ends with ROLLBACK. Review the printed counts; only when they match the
--   approved plan, run it again with the final ROLLBACK replaced by COMMIT.
-- * Take a backup first (Dashboard → Database → Backups, or pg_dump).
--
-- What each delete removes (database cascades, see deletions.test.sql):
--   project  → its tasks and subtasks → their assignments, comments,
--              attachments (rows only), time entries, dependency links,
--              notifications; activity log rows keep, with project/task = null
--   task     → its nested subtasks and the same task records
--   meeting  → its meeting records
--   client   → nothing (refused while any project still references it)
-- =============================================================================
begin;

create temp table approved (kind text not null, id uuid not null) on commit drop;
insert into approved (kind, id) values
  -- ('meeting_record', '00000000-0000-0000-0000-000000000000'),
  -- ('meeting_link',   '00000000-0000-0000-0000-000000000000'),
  -- ('daily_report',   '00000000-0000-0000-0000-000000000000'),
  -- ('task',           '00000000-0000-0000-0000-000000000000'),  -- e.g. dummy tasks in General
  -- ('project',        '00000000-0000-0000-0000-000000000000'),
  -- ('client',         '00000000-0000-0000-0000-000000000000'),
  ('none', '00000000-0000-0000-0000-000000000000');                  -- placeholder, ignored
delete from approved where kind = 'none';

-- The designated initial super admin (KEEP). Fill in before running.
create temp table keep_super_admin (email text not null) on commit drop;
insert into keep_super_admin values ('REPLACE-WITH-SUPER-ADMIN-EMAIL');

-- ---------------------------------------------------------------------------
-- Guards: stop (and roll back) on anything outside the plan.
-- ---------------------------------------------------------------------------
do $$
declare v_missing int;
begin
  if not exists (select 1 from public.profiles p join keep_super_admin k on lower(p.email) = lower(k.email) where p.role = 'SUPER_ADMIN' and p.is_active) then
    raise exception 'The designated super admin was not found as an active SUPER_ADMIN; aborting';
  end if;
  if exists (select 1 from approved a join public.projects p on p.id = a.id where a.kind = 'project' and p.is_default) then
    raise exception 'A General (default) project is listed; it cannot be deleted';
  end if;
  select count(*) into v_missing from approved a where not (
       (a.kind = 'project'        and exists (select 1 from public.projects        where id = a.id))
    or (a.kind = 'task'           and exists (select 1 from public.tasks           where id = a.id))
    or (a.kind = 'client'         and exists (select 1 from public.clients         where id = a.id))
    or (a.kind = 'daily_report'   and exists (select 1 from public.daily_reports   where id = a.id))
    or (a.kind = 'meeting_link'   and exists (select 1 from public.meeting_links   where id = a.id))
    or (a.kind = 'meeting_record' and exists (select 1 from public.meeting_records where id = a.id)));
  if v_missing > 0 then
    raise exception '% listed id(s) do not exist or have an unknown kind; re-run the audit', v_missing;
  end if;
  -- A listed client may only be deleted when all of its projects are listed too.
  if exists (select 1 from approved a join public.projects p on p.client_id = a.id
             where a.kind = 'client' and p.id not in (select id from approved where kind = 'project')) then
    raise exception 'A listed client still has projects that are not approved for deletion';
  end if;
end $$;

-- Everything that will be removed (tasks include nested subtasks).
create temp table doomed_tasks on commit drop as
with recursive t as (
  select id from public.tasks where project_id in (select id from approved where kind = 'project')
                                 or id in (select id from approved where kind = 'task')
  union
  select c.id from public.tasks c join t on c.parent_task_id = t.id
) select id from t;

select 'tasks' as removing, count(*) from doomed_tasks
union all select 'assignments', count(*) from public.task_assignees where task_id in (select id from doomed_tasks)
union all select 'comments', count(*) from public.task_comments where task_id in (select id from doomed_tasks)
union all select 'attachments', count(*) from public.task_attachments where task_id in (select id from doomed_tasks)
union all select 'time_entries', count(*) from public.time_entries where task_id in (select id from doomed_tasks)
union all select 'dependency_links', count(*) from public.task_dependencies where task_id in (select id from doomed_tasks) or depends_on_task_id in (select id from doomed_tasks)
union all select 'projects', count(*) from approved where kind = 'project'
union all select 'clients', count(*) from approved where kind = 'client'
union all select 'daily_reports', count(*) from approved where kind = 'daily_report'
union all select 'meeting_links', count(*) from approved where kind = 'meeting_link'
union all select 'meeting_records', (select count(*) from public.meeting_records where id in (select id from approved where kind = 'meeting_record') or meeting_link_id in (select id from approved where kind = 'meeting_link'));

-- Rows that must survive, counted before.
create temp table before_counts on commit drop as select
  (select count(*) from public.profiles) as profiles,
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.workspaces) as workspaces,
  (select count(*) from public.workspace_members) as memberships,
  (select count(*) from public.tasks where id not in (select id from doomed_tasks)) as other_tasks,
  (select count(*) from public.projects where id not in (select id from approved where kind = 'project')) as other_projects,
  (select count(*) from public.clients where id not in (select id from approved where kind = 'client')) as other_clients,
  (select count(*) from public.daily_reports where id not in (select id from approved where kind = 'daily_report')) as other_reports;

-- ---------------------------------------------------------------------------
-- Deletes, children before parents.
-- ---------------------------------------------------------------------------
delete from public.meeting_records where id in (select id from approved where kind = 'meeting_record');
delete from public.meeting_links   where id in (select id from approved where kind = 'meeting_link');   -- cascades its records
delete from public.daily_reports   where id in (select id from approved where kind = 'daily_report');
delete from public.tasks           where id in (select id from approved where kind = 'task');           -- cascades subtasks + task records
delete from public.projects        where id in (select id from approved where kind = 'project');        -- cascades its tasks
delete from public.clients         where id in (select id from approved where kind = 'client');         -- fails if a project still references it

-- ---------------------------------------------------------------------------
-- Verify: nothing outside the plan changed.
-- ---------------------------------------------------------------------------
do $$
declare b before_counts%rowtype;
begin
  select * into b from before_counts;
  if (select count(*) from public.profiles) <> b.profiles then raise exception 'profiles changed'; end if;
  if (select count(*) from auth.users) <> b.auth_users then raise exception 'auth users changed'; end if;
  if (select count(*) from public.workspaces) <> b.workspaces then raise exception 'workspaces changed'; end if;
  if (select count(*) from public.workspace_members) <> b.memberships then raise exception 'memberships changed'; end if;
  if (select count(*) from public.tasks) <> b.other_tasks then raise exception 'unlisted tasks changed'; end if;
  if (select count(*) from public.projects) <> b.other_projects then raise exception 'unlisted projects changed'; end if;
  if (select count(*) from public.clients) <> b.other_clients then raise exception 'unlisted clients changed'; end if;
  if (select count(*) from public.daily_reports) <> b.other_reports then raise exception 'unlisted reports changed'; end if;
  if not exists (select 1 from public.profiles p join keep_super_admin k on lower(p.email) = lower(k.email)
                 join public.workspace_members m on m.user_id = p.id where p.role = 'SUPER_ADMIN' and p.is_active) then
    raise exception 'super admin or its membership missing';
  end if;
  raise notice 'Verification passed. Replace ROLLBACK with COMMIT only if the counts above match the approved plan.';
end $$;

rollback;  -- change to COMMIT only after review and explicit approval
