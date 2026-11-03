-- =============================================================================
-- 029_meeting_participants.sql   (extends the existing meeting system; no
-- second meeting table, no data changes)
--
-- Meetings stay in public.meeting_links (006/007) with notes in
-- meeting_records (013). Added:
--   * description and end time on meeting_links (end after start when both are
--     set; times stay workspace-local, as starts_at);
--   * public.meeting_participants: named participants. A participant must be
--     an active member of the meeting's workspace, or an active super admin
--     (company-level since 025);
--   * who sees a meeting: unchanged for meetings without named participants
--     (team / everyone, 006). A meeting with named participants is visible to
--     its participants, the workspace's admins and super admins only;
--   * who schedules: super admins in any workspace (explicit workspace, 025)
--     as before, and now admins in the workspaces they belong to. Admins edit
--     and delete the meetings they created; super admins any meeting;
--   * in-app notifications through the existing notifications table:
--     MEETING_SCHEDULED when someone is added as a participant,
--     MEETING_UPDATED when the title, link, date or times change, and
--     MEETING_CANCELLED when the meeting is deactivated. The person making the
--     change is not notified. No email or push (needs a provider; not set up).
-- =============================================================================

alter type public.notification_type add value if not exists 'MEETING_SCHEDULED';
alter type public.notification_type add value if not exists 'MEETING_UPDATED';
alter type public.notification_type add value if not exists 'MEETING_CANCELLED';

alter table public.meeting_links
  add column if not exists description text check (description is null or char_length(description) <= 2000),
  add column if not exists ends_at time;
alter table public.meeting_links drop constraint if exists meeting_links_ends_after_start;
alter table public.meeting_links
  add constraint meeting_links_ends_after_start check (ends_at is null or starts_at is null or ends_at > starts_at);
grant update (description, ends_at) on public.meeting_links to authenticated;

alter table public.notifications
  add column if not exists meeting_link_id uuid references public.meeting_links (id) on delete cascade;
create index if not exists notifications_meeting_link_id_idx on public.notifications (meeting_link_id);

-- -----------------------------------------------------------------------------
-- Participants
-- -----------------------------------------------------------------------------
create table if not exists public.meeting_participants (
  meeting_link_id uuid not null references public.meeting_links (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  added_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  added_at        timestamptz not null default now(),
  primary key (meeting_link_id, user_id)
);
create index if not exists meeting_participants_user_idx on public.meeting_participants (user_id);

create or replace function private.validate_meeting_participant()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select ml.workspace_id into v_ws from public.meeting_links ml where ml.id = new.meeting_link_id;
  if not (
    private.is_active_workspace_member(v_ws, new.user_id)
    or exists (select 1 from public.profiles p where p.id = new.user_id and p.is_active and p.role = 'SUPER_ADMIN')
  ) then
    raise exception 'Participants must be active members of the meeting''s workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_meeting_participant on public.meeting_participants;
create trigger validate_meeting_participant before insert or update on public.meeting_participants
  for each row execute function private.validate_meeting_participant();

-- -----------------------------------------------------------------------------
-- Helpers (security definer: no policy recursion between the two tables)
-- -----------------------------------------------------------------------------
create or replace function private.is_meeting_participant(p_meeting_link_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.meeting_participants mp
    where mp.meeting_link_id = p_meeting_link_id and mp.user_id = (select auth.uid())
  )
$$;

create or replace function private.meeting_has_participants(p_meeting_link_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.meeting_participants mp where mp.meeting_link_id = p_meeting_link_id)
$$;

-- Super admins any meeting; admins the meetings they created in their workspaces.
create or replace function private.can_manage_meeting(p_meeting_link_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.meeting_links ml
    where ml.id = p_meeting_link_id
      and (
        private.is_workspace_super_admin(ml.workspace_id)
        or (ml.created_by = (select auth.uid())
            and private.has_workspace_role(ml.workspace_id, array['ADMIN']::public.user_role[]))
      )
  )
$$;

-- -----------------------------------------------------------------------------
-- meeting_links policies
-- -----------------------------------------------------------------------------
-- Members: team / everyone meetings without named participants (006 rule),
-- meetings they are invited to, and every meeting of a workspace they administer.
drop policy if exists "meeting_links: members read relevant links" on public.meeting_links;
create policy "meeting_links: members read relevant links"
  on public.meeting_links for select to authenticated
  using (
    workspace_id in (select private.my_workspace_ids())
    and (
      private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[])
      or private.is_meeting_participant(id)
      or (
        not private.meeting_has_participants(id)
        and (team is null or lower(team) = lower((select private.my_team())))
      )
    )
  );

-- Participants invited from outside the workspace (super admins) also see it.
drop policy if exists "meeting_links: participants read their meetings" on public.meeting_links;
create policy "meeting_links: participants read their meetings"
  on public.meeting_links for select to authenticated
  using (private.is_meeting_participant(id));

drop policy if exists "meeting_links: admins create in their workspaces" on public.meeting_links;
create policy "meeting_links: admins create in their workspaces"
  on public.meeting_links for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[])
  );

drop policy if exists "meeting_links: admins update their meetings" on public.meeting_links;
create policy "meeting_links: admins update their meetings"
  on public.meeting_links for update to authenticated
  using (created_by = (select auth.uid()) and private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[]))
  with check (created_by = (select auth.uid()) and private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[]));

drop policy if exists "meeting_links: admins delete their meetings" on public.meeting_links;
create policy "meeting_links: admins delete their meetings"
  on public.meeting_links for delete to authenticated
  using (created_by = (select auth.uid()) and private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[]));

-- -----------------------------------------------------------------------------
-- meeting_participants policies
-- -----------------------------------------------------------------------------
alter table public.meeting_participants enable row level security;
revoke all on public.meeting_participants from public, anon, authenticated;
grant select, insert, delete on public.meeting_participants to authenticated;

drop policy if exists "meeting_participants: read with the meeting" on public.meeting_participants;
create policy "meeting_participants: read with the meeting"
  on public.meeting_participants for select to authenticated
  using (exists (select 1 from public.meeting_links ml where ml.id = meeting_link_id));

drop policy if exists "meeting_participants: meeting managers add" on public.meeting_participants;
create policy "meeting_participants: meeting managers add"
  on public.meeting_participants for insert to authenticated
  with check (added_by = (select auth.uid()) and private.can_manage_meeting(meeting_link_id));

drop policy if exists "meeting_participants: meeting managers remove" on public.meeting_participants;
create policy "meeting_participants: meeting managers remove"
  on public.meeting_participants for delete to authenticated
  using (private.can_manage_meeting(meeting_link_id));

-- -----------------------------------------------------------------------------
-- Notifications (existing table; no email or push)
-- -----------------------------------------------------------------------------
create or replace function private.meeting_when(ml public.meeting_links)
returns text
language sql stable set search_path = ''
as $$
  select concat_ws(' · ',
    case when ml.meeting_date is null then 'Every day' else to_char(ml.meeting_date, 'Dy, DD Mon YYYY') end,
    case when ml.starts_at is null then null
         else to_char(ml.starts_at, 'HH24:MI') || coalesce('–' || to_char(ml.ends_at, 'HH24:MI'), '') end)
$$;

create or replace function private.notify_meeting_participant()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  ml public.meeting_links;
begin
  if new.user_id = (select auth.uid()) then
    return null;
  end if;
  select * into ml from public.meeting_links where id = new.meeting_link_id;
  if ml.is_active then
    insert into public.notifications (user_id, type, title, message, meeting_link_id)
    values (new.user_id, 'MEETING_SCHEDULED', 'Meeting: ' || ml.title, private.meeting_when(ml), ml.id);
  end if;
  return null;
end;
$$;

drop trigger if exists notify_meeting_participant on public.meeting_participants;
create trigger notify_meeting_participant after insert on public.meeting_participants
  for each row execute function private.notify_meeting_participant();

create or replace function private.notify_meeting_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_type public.notification_type;
  v_title text;
begin
  if old.is_active and not new.is_active then
    v_type := 'MEETING_CANCELLED';
    v_title := 'Meeting cancelled: ' || new.title;
  elsif new.is_active and (new.title, new.url, new.meeting_date, new.starts_at, new.ends_at)
          is distinct from (old.title, old.url, old.meeting_date, old.starts_at, old.ends_at) then
    v_type := 'MEETING_UPDATED';
    v_title := 'Meeting changed: ' || new.title;
  else
    return null;
  end if;
  insert into public.notifications (user_id, type, title, message, meeting_link_id)
  select mp.user_id, v_type, v_title, private.meeting_when(new), new.id
  from public.meeting_participants mp
  where mp.meeting_link_id = new.id
    and mp.user_id is distinct from (select auth.uid());
  return null;
end;
$$;

drop trigger if exists notify_meeting_change on public.meeting_links;
create trigger notify_meeting_change after update on public.meeting_links
  for each row execute function private.notify_meeting_change();

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on function
  private.validate_meeting_participant(),
  private.notify_meeting_participant(),
  private.notify_meeting_change(),
  private.meeting_when(public.meeting_links)
from public, anon, authenticated;
revoke all on function
  private.is_meeting_participant(uuid),
  private.meeting_has_participants(uuid),
  private.can_manage_meeting(uuid)
from public, anon;
grant execute on function
  private.is_meeting_participant(uuid),
  private.meeting_has_participants(uuid),
  private.can_manage_meeting(uuid)
to authenticated;
