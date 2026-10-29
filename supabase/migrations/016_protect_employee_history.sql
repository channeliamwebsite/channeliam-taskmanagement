-- =============================================================================
-- 016_protect_employee_history.sql   (new guard; no data, FK or permission changes)
--
-- Offboarding is deactivation (Team -> Deactivate: is_active = false plus a
-- sign-in block), which keeps everything. Deleting the account is different:
-- auth.users -> profiles is ON DELETE CASCADE (001), and from profiles
--   CASCADE   daily_reports, time_entries, task_assignees, bug_reports (007),
--             workspace_members, notifications
--   SET NULL  task_comments.user_id, activity_logs.user_id, tasks.created_by,
--             task_assignees.assigned_by, projects.owner_id / created_by,
--             clients.created_by, task_attachments.uploaded_by,
--             workspaces.created_by, meeting_links / meeting_records.created_by,
--             profiles.manager_id
-- so one "Delete user" in the Supabase dashboard or auth.admin.deleteUser()
-- erased the person's reports, time, assignments and bug reports and made
-- their comments and history anonymous. The app itself never deletes
-- accounts, and signed-in users have no delete right on profiles (002).
--
-- Retention policy enforced here:
--   * A profile that has business history cannot be deleted, so neither can
--     its auth account (the cascade from auth.users fires this trigger and the
--     whole deletion is rolled back). Deactivate the person instead.
--   * A profile with no history (e.g. an invitation sent by mistake) can still
--     be deleted; its memberships and notifications go with it as before.
--   * Exceptional erasure (e.g. a legal request) must be explicit, in one
--     transaction in the SQL editor, and removes the cascaded records above:
--       begin;
--       set local app.allow_history_deletion = 'on';
--       delete from auth.users where id = '<user id>';
--       commit;
--
-- Foreign keys are deliberately left as they are: changing the cascades to
-- RESTRICT would block the same deletions but with an unhelpful error, and
-- SET NULL is impossible for the NOT NULL user columns. Existing rows are not
-- touched; only future deletions are checked.
-- =============================================================================

create or replace function private.profile_has_history(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.daily_reports where user_id = p_user_id)
      or exists (select 1 from public.time_entries where user_id = p_user_id)
      or exists (select 1 from public.task_assignees where user_id = p_user_id or assigned_by = p_user_id)
      or exists (select 1 from public.bug_reports where reported_by = p_user_id)
      or exists (select 1 from public.task_comments where user_id = p_user_id)
      or exists (select 1 from public.activity_logs where user_id = p_user_id)
      or exists (select 1 from public.tasks where created_by = p_user_id)
      or exists (select 1 from public.projects where owner_id = p_user_id or created_by = p_user_id)
      or exists (select 1 from public.clients where created_by = p_user_id)
      or exists (select 1 from public.task_attachments where uploaded_by = p_user_id)
      or exists (select 1 from public.meeting_links where created_by = p_user_id)
      or exists (select 1 from public.meeting_records where created_by = p_user_id)
      or exists (select 1 from public.workspaces where created_by = p_user_id)
$$;

create or replace function private.protect_employee_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_history_deletion', true), '') = 'on' then
    return old;
  end if;
  if private.profile_has_history(old.id) then
    raise exception 'This employee has work history (tasks, reports, comments or activity) and cannot be deleted. Deactivate them instead.'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger protect_employee_history before delete on public.profiles
  for each row execute function private.protect_employee_history();

-- Internal helpers, not meant to be called directly.
revoke all on function private.profile_has_history(uuid), private.protect_employee_history()
  from public, anon, authenticated;
