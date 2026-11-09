-- =============================================================================
-- CHANNELIAM TASKMANAGER - FULL RESET (database part). ENDS WITH ROLLBACK.
--
-- Leaves exactly the Super Admins listed in section 0 (company-wide, no
-- workspace membership). Keeps the schema, the 39
-- migrations, functions, triggers, indexes, RLS policies, grants, extensions,
-- the four pg_cron jobs and the HR configuration (hr_settings,
-- hr_leave_policies). Removes every other row of the 28 operational tables
-- and every other profile.
--
-- NOT done here (see scripts/cleanup/README.md, step 5):
--   * Supabase Auth accounts (auth.users / auth.identities) of the other
--     people: removed afterwards with the Admin API (delete-auth-and-storage.mjs).
--     Their profiles are removed here, so they cannot use the app meanwhile.
--   * Storage files: removed with the Storage API. The bucket stays.
--
-- Run with psql as the postgres role (no signed-in app user, auth.uid() is
-- null), for example:
--   psql --single-transaction -v ON_ERROR_STOP=1 -f production-full-reset.sql
-- or paste into the Supabase SQL editor. Rehearse on STAGING first.
-- To apply for real: change the final ROLLBACK to COMMIT, nothing else.
--
-- How the delete protections are handled (each by its own design):
--   016 protect_employee_history  -> its documented switch
--                                    app.allow_history_deletion = 'on' (SET LOCAL:
--                                    this transaction only)
--   027 protect_task_history,
--   031 protect_meeting_records   -> allow deletes when auth.uid() is null (no
--                                    signed-in user), which is the case here
--   006 protect_default_project,
--   027 protect_project_history,
--   030 protect_collaborator_assignments,
--   017 audit triggers            -> allow deletes cascading from a deleted
--                                    workspace, so projects are removed through
--                                    DELETE FROM workspaces
--   021 keep_last_super_admin     -> the kept Super Admin is never deleted
--   038 protect_client_report_delete -> refuses every delete, with no exception.
--                                    It is the ONLY trigger disabled, only on
--                                    client_reports, only for that one DELETE,
--                                    and re-enabled immediately (ALTER TABLE is
--                                    transactional: an error or ROLLBACK restores
--                                    it). Verified enabled again at the end.
-- No TRUNCATE, no DROP, no session_replication_role (that would also switch
-- off foreign-key cascades).
-- =============================================================================

begin;
set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- -----------------------------------------------------------------------------
-- 0. Settings: fill in, then review. Abort on anything unexpected.
-- -----------------------------------------------------------------------------
create temporary table reset_config on commit drop as
select
  array['super-admin-1@example.com', 'super-admin-2@example.com']::text[] as keep_emails,
  3::int as expected_auth_users;  -- the 2 Super Admins + other-account@example.com (2026-11-09)

-- -----------------------------------------------------------------------------
-- 1. Preconditions
-- -----------------------------------------------------------------------------
do $$
declare
  cfg record;
  v_email text;
  v_keep uuid;
  v_keep_ids uuid[] := '{}';
  v_auth int;
  v_role text;
  v_active boolean;
  v_migrations int;
  v_jobs int;
begin
  select * into cfg from reset_config;
  foreach v_email in array cfg.keep_emails loop
    select id into v_keep from auth.users where lower(email) = lower(v_email);
    if v_keep is null then raise exception 'ABORT: % is not an Auth user', v_email; end if;
    select role::text, is_active into v_role, v_active from public.profiles where id = v_keep;
    if v_role is distinct from 'SUPER_ADMIN' or v_active is not true then
      raise exception 'ABORT: % must have an active SUPER_ADMIN profile (found role %, active %)', v_email, v_role, v_active;
    end if;
    v_keep_ids := v_keep_ids || v_keep;
  end loop;
  select count(*) into v_auth from auth.users;
  if v_auth <> cfg.expected_auth_users then
    raise exception 'ABORT: % Auth users found, expected %. Review the account list first.', v_auth, cfg.expected_auth_users;
  end if;
  select count(*) into v_migrations from supabase_migrations.schema_migrations;
  if v_migrations <> 39 then raise exception 'ABORT: % migrations recorded, expected 39', v_migrations; end if;
  select count(*) into v_jobs from cron.job;
  if v_jobs <> 4 then raise exception 'ABORT: % pg_cron jobs, expected 4', v_jobs; end if;
  if (select count(*) from public.hr_settings) <> 1 then raise exception 'ABORT: hr_settings must have exactly one row'; end if;
  if (select count(*) from public.hr_leave_policies) = 0 then raise exception 'ABORT: hr_leave_policies is empty'; end if;
  perform set_config('reset.keep_ids', array_to_string(v_keep_ids, ','), true);
  raise notice 'Keeping % (%), Auth users: %, migrations: %, cron jobs: %', cfg.keep_emails, v_keep_ids, v_auth, v_migrations, v_jobs;
end $$;

-- Structure fingerprint before (compared at the end).
create temporary table reset_fingerprint on commit drop as
select
  (select count(*) from pg_policies where schemaname in ('public','private','storage')) as policies,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where not t.tgisinternal and n.nspname in ('public','private')) as triggers,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')) as functions,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and c.relrowsecurity and n.nspname in ('public','private')) as rls_tables,
  (select count(*) from public.hr_leave_policies) as leave_policies,
  (select count(*) from storage.buckets) as buckets;

-- Row counts before.
create temporary table reset_counts on commit drop as
select table_name::text, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint as before, null::bigint as after
from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';

-- -----------------------------------------------------------------------------
-- 2. Switch for 016 (this transaction only).
-- -----------------------------------------------------------------------------
set local app.allow_history_deletion = 'on';

-- -----------------------------------------------------------------------------
-- 3. Client reports (038 refuses every delete; see header).
-- -----------------------------------------------------------------------------
alter table public.client_reports disable trigger protect_client_report_delete;
delete from public.client_reports;
alter table public.client_reports enable trigger protect_client_report_delete;
delete from public.client_report_settings;

-- -----------------------------------------------------------------------------
-- 4. People-level records (children before parents).
-- -----------------------------------------------------------------------------
delete from public.notifications;
delete from public.bug_reports;
delete from public.attendance_audit_log;
delete from public.attendance_breaks;
delete from public.attendance_sessions;
delete from public.hr_leave_applications;
delete from public.hr_leave_allowances;
delete from public.hr_employee_identity;      -- encrypted PAN / Aadhaar last 4
delete from public.hr_employee_profiles;     -- incl. the Super Admins' rows (they get no employee code)
delete from public.hr_public_holidays;
delete from public.daily_reports;

-- -----------------------------------------------------------------------------
-- 5. Meetings (records before schedules; 031 allows this without a signed-in user).
-- -----------------------------------------------------------------------------
delete from public.meeting_records;
delete from public.meeting_participants;
delete from public.meeting_links;

-- -----------------------------------------------------------------------------
-- 6. Task details, then tasks (027 allows this without a signed-in user;
--    deleting a parent also removes its subtasks).
-- -----------------------------------------------------------------------------
delete from public.time_entries;
delete from public.task_dependencies;
delete from public.task_attachments;          -- rows only; files are in Storage (step 5 of the README)
delete from public.task_comments;
delete from public.task_assignees;
delete from public.tasks;

-- -----------------------------------------------------------------------------
-- 7. Workspaces. Cascades to projects (incl. the default General project, which
--    006 allows only through this cascade), project collaborators, clients and
--    memberships.
-- -----------------------------------------------------------------------------
delete from public.workspaces;

-- -----------------------------------------------------------------------------
-- 8. Activity log (also catches rows the audit triggers wrote during steps 3-7).
-- -----------------------------------------------------------------------------
delete from public.activity_logs;

-- -----------------------------------------------------------------------------
-- 9. Every profile except the kept Super Admin. Their Auth accounts are removed
--    afterwards with the Admin API; without a profile they cannot use the app.
--    hr_settings / hr_leave_policies.updated_by become null (on delete set null).
-- -----------------------------------------------------------------------------
delete from public.profiles where not (id = any (string_to_array(current_setting('reset.keep_ids'), ',')::uuid[]));

-- Employee codes restart: the next employee gets the first number (CH-0001
-- with today's format; CH001 once migration 040 changes it).
select setval('public.hr_employee_code_seq', 1, false);
delete from public.activity_logs;             -- anything logged by step 9

-- -----------------------------------------------------------------------------
-- 10. Verify and report.
-- -----------------------------------------------------------------------------
update reset_counts r
   set after = (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', r.table_name), false, true, '')))[1]::text::bigint;

select table_name, before, after from reset_counts order by table_name;

do $$
declare
  v_keep uuid[] := string_to_array(current_setting('reset.keep_ids'), ',')::uuid[];
  f record;
  bad text;
begin
  select string_agg(table_name || '=' || after, ', ') into bad
    from reset_counts
   where after <> 0 and table_name not in ('profiles', 'hr_settings', 'hr_leave_policies');
  if bad is not null then raise exception 'ABORT: rows left in %', bad; end if;
  if (select count(*) from public.profiles) <> cardinality(v_keep)
     or (select count(*) from public.profiles where id = any (v_keep) and role = 'SUPER_ADMIN' and is_active) <> cardinality(v_keep) then
    raise exception 'ABORT: the remaining profiles must be exactly the kept active Super Admins';
  end if;
  if exists (select 1 from public.workspace_members where user_id = any (v_keep)) then
    raise exception 'ABORT: Super Admins must not have workspace memberships';
  end if;
  if (select is_called or last_value <> 1 from public.hr_employee_code_seq) then
    raise exception 'ABORT: employee code sequence was not restarted';
  end if;
  if (select count(*) from public.hr_settings) <> 1 then raise exception 'ABORT: hr_settings changed'; end if;
  select * into f from reset_fingerprint;
  if f.leave_policies <> (select count(*) from public.hr_leave_policies) then raise exception 'ABORT: hr_leave_policies changed'; end if;
  if f.policies <> (select count(*) from pg_policies where schemaname in ('public','private','storage')) then raise exception 'ABORT: RLS policies changed'; end if;
  if f.triggers <> (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                    where not t.tgisinternal and n.nspname in ('public','private')) then raise exception 'ABORT: triggers changed'; end if;
  if f.functions <> (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')) then raise exception 'ABORT: functions changed'; end if;
  if f.rls_tables <> (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and c.relrowsecurity and n.nspname in ('public','private')) then raise exception 'ABORT: RLS settings changed'; end if;
  if f.buckets <> (select count(*) from storage.buckets) then raise exception 'ABORT: storage buckets changed'; end if;
  if (select count(*) from supabase_migrations.schema_migrations) <> 39 then raise exception 'ABORT: migration history changed'; end if;
  if (select count(*) from cron.job) <> 4 then raise exception 'ABORT: pg_cron jobs changed'; end if;
  if exists (select 1 from pg_trigger where tgname = 'protect_client_report_delete' and tgenabled = 'D') then
    raise exception 'ABORT: protect_client_report_delete is still disabled';
  end if;
  raise notice 'VERIFIED: only the kept Super Admin profiles and the HR configuration remain; structure unchanged; employee code sequence restarted.';
  raise notice 'Auth users still present (removed later with the Admin API): %', (select count(*) from auth.users);
end $$;

-- Default: undo everything. Change to COMMIT only after an approved rehearsal.
rollback;
