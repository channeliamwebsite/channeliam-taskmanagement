-- =============================================================================
-- 031_protect_meeting_records.sql   (data protection: deletion guard; no data
-- or permission changes)
--
-- Defect found in the release audit: since 029 an admin may delete a meeting
-- they created. meeting_records (013: per-date agenda, notes, decisions and
-- follow-up tasks, written and readable by super admins only) reference the
-- meeting ON DELETE CASCADE, so that deletion silently destroyed the super
-- admin's notes, which the admin could not even see.
--
-- Fix: a meeting that has meeting records cannot be deleted by a signed-in
-- user, whatever their role or however the request arrives (UI, server action
-- or direct API call). Deactivating it (is_active = false, existing since 006)
-- keeps the schedule and its records and notifies participants (029). A
-- meeting without records can still be deleted by those allowed to (RLS
-- unchanged). Super admins can still delete individual records explicitly
-- (013 policy unchanged).
--
-- Not blocked, as in 027: calls without a signed-in user (service role, SQL
-- editor) and removal of a whole workspace (only possible without a signed-in
-- user since 023), where the workspace row is already gone.
-- =============================================================================

create or replace function private.protect_meeting_records()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;
  if exists (select 1 from public.meeting_records r where r.meeting_link_id = old.id) then
    raise exception 'This meeting has meeting records (notes or decisions). Deactivate it instead of deleting it.'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_meeting_records on public.meeting_links;
create trigger protect_meeting_records before delete on public.meeting_links
  for each row execute function private.protect_meeting_records();

revoke all on function private.protect_meeting_records() from public, anon, authenticated;
