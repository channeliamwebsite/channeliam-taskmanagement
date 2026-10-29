-- =============================================================================
-- 021_last_super_admin_delete_guard.sql   (extends the 015 guard; no data changes)
--
-- 015 keeps at least one active super admin when a profile is UPDATED (demoted
-- or deactivated). Deleting the profile was not covered: auth.users ->
-- profiles is ON DELETE CASCADE (001), and 016 only refuses deletion when the
-- person has work history, so the last active super admin could still be
-- deleted from the Supabase dashboard / auth admin API if they had no history
-- yet, or with 016's explicit erasure override.
--
-- Now the same guard also runs BEFORE DELETE on profiles, which also fires
-- for the cascade from auth.users, so the whole account deletion is refused.
-- There is no override: promote another person to super admin first, then
-- deactivate or delete. Offboarding by deactivation is unchanged (allowed
-- while another active super admin remains).
--
-- One function serves both triggers, so updates and deletions share the same
-- advisory lock and are checked one at a time (no two removals can each see
-- the other's super admin). The lock is taken before any row lock, keeping the
-- lock order fixed; a multi-statement transaction that already holds a super
-- admin row lock can still be chosen as a deadlock victim, which fails safely.
--
-- Trigger order on DELETE (alphabetical): keep_last_super_admin_on_delete,
-- then protect_employee_history (016). RLS and grants are unchanged:
-- signed-in users still cannot delete profiles at all.
-- =============================================================================

create or replace function private.keep_last_super_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if not (old.role = 'SUPER_ADMIN' and old.is_active) then
      return old;
    end if;
  elsif not (old.role = 'SUPER_ADMIN' and old.is_active)
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

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger keep_last_super_admin_on_delete before delete on public.profiles
  for each row execute function private.keep_last_super_admin();

revoke all on function private.keep_last_super_admin() from public, anon, authenticated;
