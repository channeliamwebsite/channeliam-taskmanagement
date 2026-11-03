-- =============================================================================
-- 032_inactive_accounts_no_access.sql   (permission change: restrictive
-- policies only; no data changes)
--
-- Defect found while testing employee deactivation: most data is reachable
-- only through helpers that require an active account (private.current_user_role()
-- is null for deactivated users), but a few "own rows" policies compare
-- user_id with auth.uid() directly. A deactivated employee whose session token
-- had not expired yet (up to jwt_expiry; the Auth sign-in block stops refreshes)
-- could therefore still read their own daily reports, notifications,
-- attendance, bug reports and time entries, and mark or delete their own
-- notifications.
--
-- Fix: one RESTRICTIVE policy per affected table, for every command, that
-- requires an active account. Restrictive policies are ANDed with the existing
-- permissive ones, so nothing is granted to anyone; active users (every role)
-- are unaffected. Not applied to public.profiles: sign-in and the session check
-- read the caller's own profile to tell a deactivated person why they cannot
-- continue. Writes by SECURITY DEFINER functions and triggers (attendance,
-- report submission, notifications) are unaffected.
-- =============================================================================

drop policy if exists "daily_reports: active accounts only" on public.daily_reports;
create policy "daily_reports: active accounts only"
  on public.daily_reports as restrictive for all to authenticated
  using ((select private.current_user_role()) is not null)
  with check ((select private.current_user_role()) is not null);

drop policy if exists "notifications: active accounts only" on public.notifications;
create policy "notifications: active accounts only"
  on public.notifications as restrictive for all to authenticated
  using ((select private.current_user_role()) is not null)
  with check ((select private.current_user_role()) is not null);

drop policy if exists "attendance_sessions: active accounts only" on public.attendance_sessions;
create policy "attendance_sessions: active accounts only"
  on public.attendance_sessions as restrictive for all to authenticated
  using ((select private.current_user_role()) is not null)
  with check ((select private.current_user_role()) is not null);

drop policy if exists "attendance_audit_log: active accounts only" on public.attendance_audit_log;
create policy "attendance_audit_log: active accounts only"
  on public.attendance_audit_log as restrictive for all to authenticated
  using ((select private.current_user_role()) is not null)
  with check ((select private.current_user_role()) is not null);

drop policy if exists "bug_reports: active accounts only" on public.bug_reports;
create policy "bug_reports: active accounts only"
  on public.bug_reports as restrictive for all to authenticated
  using ((select private.current_user_role()) is not null)
  with check ((select private.current_user_role()) is not null);

drop policy if exists "time_entries: active accounts only" on public.time_entries;
create policy "time_entries: active accounts only"
  on public.time_entries as restrictive for all to authenticated
  using ((select private.current_user_role()) is not null)
  with check ((select private.current_user_role()) is not null);
