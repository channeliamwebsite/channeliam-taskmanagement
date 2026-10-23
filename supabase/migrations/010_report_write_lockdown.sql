-- =============================================================================
-- 010_report_write_lockdown.sql   (security boundary — apply LAST)
--
-- After this migration ordinary users can no longer write daily_reports rows
-- directly. Reports are created and updated only through
-- public.submit_morning_plan / public.submit_evening_report (migration 009),
-- which fix the date, first-submission times, counts and snapshot on the
-- server. Users can no longer:
--   * create a report for another date or move a report to another date;
--   * set or overwrite submission timestamps, counts or snapshots;
--   * delete reports (historical or current).
-- Read access is unchanged: owners, plus admins and super admins of the
-- workspace (policy "daily_reports: own reports, or admins of the workspace").
--
-- Release order (see also the report at the end of this change set):
--   1. apply 009  — the current app keeps working (direct writes still allowed)
--   2. deploy the app version whose report actions call the 009 functions
--   3. apply 010  — app versions that write daily_reports directly STOP working
--      for report submission (permission denied). Do not apply 010 before step 2.
--
-- Before applying, record the environment's current privileges so that any
-- recovery restores what was actually there (do not rebuild them from old
-- migration files):
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'daily_reports';
--   select grantee, column_name, privilege_type from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'daily_reports';
--   select policyname, cmd, qual, with_check from pg_policies where tablename = 'daily_reports';
-- =============================================================================

-- Refuse to run without the submission functions from 009.
do $$
begin
  if to_regprocedure('public.submit_morning_plan(uuid, text, uuid[])') is null
     or to_regprocedure('public.submit_evening_report(uuid, numeric, text, text, text, text, uuid[])') is null then
    raise exception '010 requires migration 009 (public.submit_morning_plan / public.submit_evening_report)';
  end if;
end;
$$;

-- Remove every direct write path. Revoking a table-level privilege also
-- revokes the matching column-level privileges (the INSERT column list from
-- 009 and the UPDATE column lists from 002, 004 and 007).
revoke insert, update, delete on public.daily_reports from public, anon, authenticated;

-- Deleting reports is no longer allowed for anyone but the database owner.
drop policy if exists "daily_reports: owners can delete" on public.daily_reports;

-- The INSERT and UPDATE policies ("members submit their own", "owners can
-- update") are left in place; without INSERT/UPDATE privileges they no longer
-- apply to clients, and keeping them makes a privilege-only rollback possible.

-- Self-check: fail the migration (and roll it back) unless the end state is
-- exactly: readable, not directly writable, submittable through the functions.
do $$
begin
  if has_table_privilege('authenticated', 'public.daily_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.daily_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.daily_reports', 'DELETE')
     or has_any_column_privilege('authenticated', 'public.daily_reports', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.daily_reports', 'UPDATE') then
    raise exception 'daily_reports is still directly writable by authenticated';
  end if;
  if has_any_column_privilege('anon', 'public.daily_reports', 'SELECT,INSERT,UPDATE') then
    raise exception 'anon still has privileges on daily_reports';
  end if;
  if not has_table_privilege('authenticated', 'public.daily_reports', 'SELECT') then
    raise exception 'authenticated lost SELECT on daily_reports';
  end if;
  if not has_function_privilege('authenticated', 'public.submit_morning_plan(uuid, text, uuid[])', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.submit_evening_report(uuid, numeric, text, text, text, text, uuid[])', 'EXECUTE') then
    raise exception 'authenticated cannot execute the report submission functions';
  end if;
  if has_function_privilege('anon', 'public.submit_morning_plan(uuid, text, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.submit_evening_report(uuid, numeric, text, text, text, text, uuid[])', 'EXECUTE') then
    raise exception 'anon can execute the report submission functions';
  end if;
end;
$$;
