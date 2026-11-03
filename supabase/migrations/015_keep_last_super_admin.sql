-- =============================================================================
-- 015_keep_last_super_admin.sql   (new guard; no data or permission changes)
--
-- The company must always keep at least one active super admin (role
-- SUPER_ADMIN and is_active, the same definition private.current_user_role
-- uses). Roles are company-wide, so the count is across all profiles.
--
-- Why in the database: through the app the caller is always an active super
-- admin who cannot change their own role or active flag (guard_profile_update,
-- 003/004), so one request can never remove the last one. Two super admins
-- demoting or deactivating each other at the same moment could, and so could
-- edits made without a user (service role, SQL editor, Supabase dashboard),
-- which guard_profile_update deliberately trusts. This trigger covers both.
--
-- Concurrency: every change that takes away an active super admin first takes
-- one transaction-level advisory lock, so these checks run one at a time; the
-- second waits for the first to commit and then counts what is really left.
-- The remaining super admin row is also locked (FOR UPDATE) so it cannot be
-- changed underneath the check, including under REPEATABLE READ.
--
-- Unchanged: RLS, column grants, guard_profile_update and its error messages
-- (the trigger is named to fire after it, so unauthorized callers still get
-- 42501), and every update that does not remove an active super admin
-- (names, teams, managers, promotions, other roles). Deleting a profile is not
-- covered here.
-- =============================================================================

create or replace function private.keep_last_super_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not (old.role = 'SUPER_ADMIN' and old.is_active)
     or (new.role = 'SUPER_ADMIN' and new.is_active) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.profiles:keep_last_super_admin'));

  perform 1
  from public.profiles p
  where p.role = 'SUPER_ADMIN' and p.is_active and p.id <> old.id
  limit 1
  for update;

  if not found then
    raise exception 'At least one active super admin must remain. Make another person a super admin first.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger keep_last_super_admin before update of role, is_active on public.profiles
  for each row execute function private.keep_last_super_admin();

-- Trigger functions are not meant to be called directly.
revoke all on function private.keep_last_super_admin() from public, anon, authenticated;
