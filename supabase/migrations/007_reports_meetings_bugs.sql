-- =============================================================================
-- 007_reports_meetings_bugs.sql   (additive, non-destructive)
--   * daily_reports: morning plan + separate morning/evening submission times
--     (one row per user/workspace/day is kept; no new report table)
--   * meeting_links: kind (MORNING/EVENING/OTHER), start time, optional date
--   * bug_reports: minimal table for in-app bug reports
-- Priority targets use the existing task_assignees.assigned_at; departments
-- use the existing profiles.team. No changes needed for those.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Daily reports: morning plan / evening report
-- -----------------------------------------------------------------------------
alter table public.daily_reports
  add column morning_plan text check (morning_plan is null or char_length(morning_plan) <= 10000),
  add column planned_task_ids uuid[] not null default '{}',
  add column morning_submitted_at timestamptz,
  add column evening_submitted_at timestamptz;

-- Reports submitted before this migration were end-of-day reports.
alter table public.daily_reports disable trigger set_updated_at;
update public.daily_reports set evening_submitted_at = updated_at where evening_submitted_at is null;
alter table public.daily_reports enable trigger set_updated_at;

grant update (morning_plan, planned_task_ids, morning_submitted_at, evening_submitted_at)
  on public.daily_reports to authenticated;

-- -----------------------------------------------------------------------------
-- Meeting links: morning / evening meetings with a time
-- -----------------------------------------------------------------------------
alter table public.meeting_links
  add column kind text not null default 'OTHER' check (kind in ('MORNING', 'EVENING', 'OTHER')),
  add column starts_at time,
  -- null = recurring (every working day); otherwise a one-off meeting date.
  add column meeting_date date;

grant update (kind, starts_at, meeting_date) on public.meeting_links to authenticated;

-- -----------------------------------------------------------------------------
-- Bug reports
-- -----------------------------------------------------------------------------
create table public.bug_reports (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reported_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title        text not null check (char_length(trim(title)) between 1 and 200),
  description  text not null check (char_length(trim(description)) between 1 and 5000),
  page         text check (page is null or char_length(page) <= 300),
  steps        text check (steps is null or char_length(steps) <= 5000),
  status       text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index bug_reports_workspace_created_idx on public.bug_reports (workspace_id, created_at desc);
create index bug_reports_reported_by_idx on public.bug_reports (reported_by);

create trigger set_updated_at before update on public.bug_reports
  for each row execute function private.set_updated_at();

alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;
grant select, insert on public.bug_reports to authenticated;
grant update (status) on public.bug_reports to authenticated;

-- Reporters see their own reports; admins and super admins review the workspace's.
create policy "bug_reports: reporters and admins read"
  on public.bug_reports for select to authenticated
  using (
    reported_by = (select auth.uid())
    or private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[])
  );

-- Any active member can report a bug for themselves; new reports start OPEN.
create policy "bug_reports: members submit their own"
  on public.bug_reports for insert to authenticated
  with check (
    reported_by = (select auth.uid())
    and status = 'OPEN'
    and private.is_workspace_member(workspace_id)
  );

-- Only admins/super admins change status (status is the only updatable column).
create policy "bug_reports: admins update status"
  on public.bug_reports for update to authenticated
  using (private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[]))
  with check (private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[]));
