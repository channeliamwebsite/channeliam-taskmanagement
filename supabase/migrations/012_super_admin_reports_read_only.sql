-- =============================================================================
-- 012_super_admin_reports_read_only.sql   (behaviour change; no schema change)
--
-- Super admins review daily reports; they do not submit their own. The app
-- already hides the forms and its server actions refuse super admins; this
-- closes the same gap for direct calls to the database API.
--
-- public.submit_morning_plan and public.submit_evening_report both identify
-- the caller through private.report_author (migration 009), so the role check
-- is added there once. Everything else is unchanged:
--   * the active-workspace-membership check and its error;
--   * Admin and Individual submissions;
--   * grants (CREATE OR REPLACE keeps them; the revoke below restates them);
--   * RLS on daily_reports (read access, 010 write lock-down);
--   * automatic morning snapshots (private.generate_morning_reports does not
--     call report_author) and existing report rows, including any a super
--     admin submitted before this migration.
-- Roles are company-wide: a super admin later changed to Admin can submit again.
-- =============================================================================

create or replace function private.report_author(p_workspace_id uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_workspace_id is null or not private.is_active_workspace_member(p_workspace_id, v_uid) then
    raise exception 'Reports can only be submitted by active members of the workspace' using errcode = '42501';
  end if;
  if private.current_user_role() = 'SUPER_ADMIN' then
    raise exception 'Super admins review daily reports; they do not submit them' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function private.report_author(uuid) from public, anon, authenticated;
