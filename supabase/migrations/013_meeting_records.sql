-- =============================================================================
-- 013_meeting_records.sql   (additive)
--
-- Notes for internal meetings, kept per meeting and date. Meetings themselves
-- stay in public.meeting_links (migration 007: title, link, morning/evening
-- kind, start time, one-off date or every day, department or everyone),
-- managed by super admins in Settings. A recurring meeting is one
-- meeting_links row, so what happened at each occurrence is recorded here:
-- status, agenda, notes, decisions and follow-up tasks.
--
-- Super admins of the workspace only (read and write). Admin and Individual
-- access to meetings is unchanged.
-- =============================================================================

create table public.meeting_records (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  meeting_link_id    uuid not null references public.meeting_links (id) on delete cascade,
  meeting_date       date not null,
  status             text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'HELD', 'CANCELLED')),
  agenda             text check (agenda is null or char_length(agenda) <= 5000),
  notes              text check (notes is null or char_length(notes) <= 10000),
  decisions          text check (decisions is null or char_length(decisions) <= 5000),
  -- Existing tasks agreed as follow-up actions (validated by the app; a deleted
  -- task simply no longer resolves).
  follow_up_task_ids uuid[] not null default '{}' check (cardinality(follow_up_task_ids) <= 50),
  created_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (meeting_link_id, meeting_date)
);

comment on table public.meeting_records is
  'Per-date status, agenda, notes, decisions and follow-up tasks for a meeting_links meeting (super admins only).';

create index meeting_records_workspace_date_idx on public.meeting_records (workspace_id, meeting_date desc);

create trigger set_updated_at before update on public.meeting_records
  for each row execute function private.set_updated_at();

alter table public.meeting_records enable row level security;

-- The record must belong to the same workspace as its meeting.
create policy "meeting_records: super admins read" on public.meeting_records
  for select to authenticated
  using (private.is_workspace_super_admin(workspace_id));

create policy "meeting_records: super admins create" on public.meeting_records
  for insert to authenticated
  with check (
    private.is_workspace_super_admin(workspace_id)
    and exists (select 1 from public.meeting_links ml where ml.id = meeting_link_id and ml.workspace_id = meeting_records.workspace_id)
  );

create policy "meeting_records: super admins update" on public.meeting_records
  for update to authenticated
  using (private.is_workspace_super_admin(workspace_id))
  with check (
    private.is_workspace_super_admin(workspace_id)
    and exists (select 1 from public.meeting_links ml where ml.id = meeting_link_id and ml.workspace_id = meeting_records.workspace_id)
  );

create policy "meeting_records: super admins delete" on public.meeting_records
  for delete to authenticated
  using (private.is_workspace_super_admin(workspace_id));

revoke all on public.meeting_records from public, anon;
grant select, insert, update, delete on public.meeting_records to authenticated;
