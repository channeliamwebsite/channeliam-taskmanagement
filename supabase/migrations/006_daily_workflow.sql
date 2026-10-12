-- =============================================================================
-- 006_daily_workflow.sql   (additive; safe to re-run the data steps)
--
--   A. tasks.completed_at maintained by trigger; new tasks default their
--      scheduled_date to "today" in the workspace timezone.
--   C. One default "General" project per workspace (is_default), created for
--      existing and future workspaces; it cannot be deleted directly.
--   D. Individuals may create tasks in the General project assigned only to
--      themselves (RLS + server action).
--   E. meeting_links (organisation-wide or per team), super-admin managed.
--   F. Daily reminder digests (9:00 local time) via pg_cron, de-duplicated
--      per recipient and date.
--   H. Client contact columns readable by admins only; atomic task creation
--      and reassignment through SECURITY INVOKER functions (RLS still applies).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Completion timestamp + default schedule
-- -----------------------------------------------------------------------------
alter table public.tasks add column completed_at timestamptz;

-- Backfill: the latest completion event, else the last update time. The
-- updated_at trigger is suspended so the backfill doesn't look like an edit.
alter table public.tasks disable trigger set_updated_at;
update public.tasks t
set completed_at = coalesce(
  (select max(a.created_at) from public.activity_logs a where a.task_id = t.id and a.action = 'TASK_COMPLETED'),
  t.updated_at
)
where t.status = 'COMPLETED' and t.completed_at is null;
alter table public.tasks enable trigger set_updated_at;

create index tasks_workspace_completed_idx on public.tasks (workspace_id, completed_at)
  where completed_at is not null;

-- Sets completed_at when a task becomes COMPLETED, clears it when reopened, and
-- keeps the original timestamp when unrelated fields change. Not client-writable
-- (no column grant), so it cannot be forged.
create or replace function private.track_task_completion()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.completed_at := case when new.status = 'COMPLETED' then now() else null end;
  elsif new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED' then
    new.completed_at := now();
  elsif new.status <> 'COMPLETED' then
    new.completed_at := null;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

create trigger track_task_completion before insert or update on public.tasks
  for each row execute function private.track_task_completion();

-- New tasks without a scheduled date are planned for "today" in their
-- workspace's timezone. Explicit scheduled/due dates are left untouched.
create or replace function private.set_task_schedule_default()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_tz text;
begin
  if new.scheduled_date is null then
    select w.timezone into v_tz
    from public.projects p join public.workspaces w on w.id = p.workspace_id
    where p.id = new.project_id;
    if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
      v_tz := 'Asia/Kolkata';
    end if;
    new.scheduled_date := (now() at time zone v_tz)::date;
  end if;
  return new;
end;
$$;

create trigger set_task_schedule_default before insert on public.tasks
  for each row execute function private.set_task_schedule_default();

-- -----------------------------------------------------------------------------
-- C. Default "General" project per workspace
-- -----------------------------------------------------------------------------
alter table public.projects add column is_default boolean not null default false;
create unique index projects_one_default_per_workspace on public.projects (workspace_id) where is_default;

-- Repeatable: reuse an existing project named "General" if there is one,
-- otherwise create it. Never creates a second default.
update public.projects p
set is_default = true
where p.id in (
  select distinct on (p2.workspace_id) p2.id
  from public.projects p2
  where lower(trim(p2.name)) = 'general'
    and not exists (select 1 from public.projects d where d.workspace_id = p2.workspace_id and d.is_default)
  order by p2.workspace_id, p2.created_at
);

insert into public.projects (workspace_id, name, description, status, is_default, created_by)
select w.id, 'General', 'Default project for everyday tasks', 'ACTIVE', true, w.created_by
from public.workspaces w
where not exists (select 1 from public.projects p where p.workspace_id = w.id and p.is_default);

create or replace function private.ensure_default_project()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.projects (workspace_id, name, description, status, is_default, created_by)
  select new.id, 'General', 'Default project for everyday tasks', 'ACTIVE', true, new.created_by
  where not exists (select 1 from public.projects p where p.workspace_id = new.id and p.is_default);
  return null;
end;
$$;

create trigger ensure_default_project after insert on public.workspaces
  for each row execute function private.ensure_default_project();

-- The General project holds everyday tasks; deleting it directly would delete
-- them all. Cascades from deleting the whole workspace are still allowed.
create or replace function private.protect_default_project()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.is_default and pg_trigger_depth() = 1 then
    raise exception 'The default General project cannot be deleted' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger protect_default_project before delete on public.projects
  for each row execute function private.protect_default_project();

-- Every member may see the General project (it holds no data by itself;
-- tasks inside it keep their own RLS).
create policy "projects: members read the default project"
  on public.projects for select to authenticated
  using (is_default and workspace_id in (select private.my_workspace_ids()));

-- -----------------------------------------------------------------------------
-- D. Individuals: self-assigned tasks in the General project
-- -----------------------------------------------------------------------------
create or replace function private.is_member_default_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.is_default and private.is_workspace_member(p.workspace_id)
  )
$$;

create or replace function private.is_own_created_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.tasks t where t.id = p_task_id and t.created_by = (select auth.uid()))
$$;

create policy "tasks: individuals create own tasks in the General project"
  on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.current_user_role()) = 'INDIVIDUAL'
    and parent_task_id is null
    and private.is_member_default_project(project_id)
  );

create policy "task_assignees: individuals self-assign their own tasks"
  on public.task_assignees for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and assigned_by = (select auth.uid())
    and (select private.current_user_role()) = 'INDIVIDUAL'
    and private.is_own_created_task(task_id)
  );

-- -----------------------------------------------------------------------------
-- E. Meeting links
-- -----------------------------------------------------------------------------
create table public.meeting_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- null = organisation-wide; otherwise matches profiles.team (e.g. "Production").
  team         text check (team is null or char_length(trim(team)) between 1 and 100),
  title        text not null check (char_length(trim(title)) between 1 and 200),
  url          text not null check (char_length(url) <= 2000 and url ~* '^https://[^\s/$.?#].[^\s]*$'),
  schedule     text check (schedule is null or char_length(schedule) <= 200),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index meeting_links_workspace_idx on public.meeting_links (workspace_id, sort_order);
create index meeting_links_created_by_idx on public.meeting_links (created_by);

create trigger set_updated_at before update on public.meeting_links
  for each row execute function private.set_updated_at();

create or replace function private.my_team()
returns text
language sql stable security definer set search_path = ''
as $$
  select p.team from public.profiles p where p.id = (select auth.uid()) and p.is_active
$$;

alter table public.meeting_links enable row level security;
revoke all on public.meeting_links from anon, authenticated;
grant select, insert, delete on public.meeting_links to authenticated;
grant update (team, title, url, schedule, sort_order, is_active) on public.meeting_links to authenticated;

-- Members see the organisation-wide meeting and their own team's meetings;
-- admins see all meetings of their workspaces.
create policy "meeting_links: members read relevant links"
  on public.meeting_links for select to authenticated
  using (
    workspace_id in (select private.my_workspace_ids())
    and (
      team is null
      or lower(team) = lower((select private.my_team()))
      or private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[])
    )
  );

create policy "meeting_links: super admins create"
  on public.meeting_links for insert to authenticated
  with check (created_by = (select auth.uid()) and private.is_workspace_super_admin(workspace_id));

create policy "meeting_links: super admins update"
  on public.meeting_links for update to authenticated
  using (private.is_workspace_super_admin(workspace_id))
  with check (private.is_workspace_super_admin(workspace_id));

create policy "meeting_links: super admins delete"
  on public.meeting_links for delete to authenticated
  using (private.is_workspace_super_admin(workspace_id));

-- -----------------------------------------------------------------------------
-- F. Daily reminder digests
-- -----------------------------------------------------------------------------
alter table public.notifications add column reminder_date date;
create unique index notifications_one_reminder_per_day
  on public.notifications (user_id, reminder_date) where reminder_date is not null;

-- One digest per active assignee per local day, sent when the workspace's
-- local time is 09:00–09:29 (the job runs every 30 minutes). Re-running is
-- harmless: the unique index drops duplicates. p_now / p_force exist for tests.
create or replace function private.send_daily_reminders(p_now timestamptz default now(), p_force boolean default false)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  with ws as (
    select w.id,
           (p_now at time zone w.timezone)::date as local_date,
           (p_now at time zone w.timezone)::time as local_time
    from public.workspaces w
    where w.timezone in (select name from pg_catalog.pg_timezone_names)
  ),
  counts as (
    select ta.user_id,
           ws.local_date,
           count(distinct t.id) filter (where t.due_date = ws.local_date) as due_today,
           count(distinct t.id) filter (where t.scheduled_date < ws.local_date) as carried,
           count(distinct t.id) filter (where t.due_date < ws.local_date) as overdue
    from ws
    join public.tasks t on t.workspace_id = ws.id and t.status not in ('COMPLETED', 'CANCELLED')
    join public.task_assignees ta on ta.task_id = t.id
    join public.profiles p on p.id = ta.user_id and p.is_active
    join public.workspace_members wm on wm.workspace_id = ws.id and wm.user_id = ta.user_id
    where p_force or (ws.local_time >= time '09:00' and ws.local_time < time '09:30')
    group by ta.user_id, ws.local_date
  )
  insert into public.notifications (user_id, type, title, message, reminder_date)
  select c.user_id,
         'TASK_DUE_SOON',
         'Your tasks for today',
         format('%s due today · %s carried forward · %s overdue', c.due_today, c.carried, c.overdue),
         c.local_date
  from counts c
  where c.due_today + c.carried + c.overdue > 0
  on conflict (user_id, reminder_date) where reminder_date is not null do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Schedule with pg_cron when available (Supabase supports it). Otherwise the
-- function can be run by any scheduler with database access:
--   select private.send_daily_reminders();
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('daily-task-reminders', '0,30 * * * *', 'select private.send_daily_reminders()');
  else
    raise notice 'pg_cron is not available; schedule "select private.send_daily_reminders()" every 30 minutes manually.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- H1. Client contact details: admins only
-- -----------------------------------------------------------------------------
revoke select on public.clients from authenticated;
grant select (id, workspace_id, name, notes, is_active, created_by, created_at, updated_at)
  on public.clients to authenticated;

create or replace function public.get_client_contacts(p_workspace_id uuid)
returns table (id uuid, contact_name text, contact_email text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.contact_name, c.contact_email
  from public.clients c
  where c.workspace_id = p_workspace_id
    and private.has_workspace_role(p_workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[])
$$;

-- -----------------------------------------------------------------------------
-- H2. Atomic task creation and reassignment (SECURITY INVOKER: every
--     statement runs as the caller, so RLS and triggers still decide).
-- -----------------------------------------------------------------------------
create or replace function public.create_task(
  p_project_id uuid,
  p_title text,
  p_assignee_ids uuid[],
  p_primary_assignee_id uuid default null,
  p_parent_task_id uuid default null,
  p_description text default null,
  p_status public.task_status default 'TODO',
  p_priority public.priority_level default 'MEDIUM',
  p_task_type public.task_type default 'TASK',
  p_start_date date default null,
  p_scheduled_date date default null,
  p_due_date date default null,
  p_estimated_hours numeric default null
)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_workspace uuid;
  v_ids uuid[];
  v_primary uuid;
  v_task uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select array_agg(distinct u) into v_ids from unnest(p_assignee_ids) u where u is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Assign at least one person' using errcode = '23514';
  end if;
  v_primary := case when p_primary_assignee_id = any (v_ids) then p_primary_assignee_id else v_ids[1] end;

  select p.workspace_id into v_workspace from public.projects p where p.id = p_project_id;
  if v_workspace is null then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  insert into public.tasks (
    project_id, workspace_id, parent_task_id, title, description, status, priority, task_type,
    start_date, scheduled_date, due_date, estimated_hours, progress, created_by
  ) values (
    p_project_id, v_workspace, p_parent_task_id, p_title, p_description, p_status, p_priority, p_task_type,
    p_start_date, p_scheduled_date, p_due_date, p_estimated_hours,
    case when p_status = 'COMPLETED' then 100 else 0 end, v_uid
  )
  returning id into v_task;

  insert into public.task_assignees (task_id, user_id, assigned_by, is_primary)
  select v_task, u, v_uid, u = v_primary from unnest(v_ids) u;

  return v_task;
end;
$$;

create or replace function public.set_task_assignees(p_task_id uuid, p_user_ids uuid[], p_primary_id uuid default null)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_expected integer;
  v_removed integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.can_manage_task(p_task_id) then
    raise exception 'You don''t have permission to assign this task' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct u), '{}') into v_ids from unnest(p_user_ids) u where u is not null;

  select count(*) into v_expected
  from public.task_assignees ta
  where ta.task_id = p_task_id and not (ta.user_id = any (v_ids));

  delete from public.task_assignees ta
  where ta.task_id = p_task_id and not (ta.user_id = any (v_ids));
  get diagnostics v_removed = row_count;
  if v_removed <> v_expected then
    raise exception 'You don''t have permission to remove some assignees' using errcode = '42501';
  end if;

  insert into public.task_assignees (task_id, user_id, assigned_by, is_primary)
  select p_task_id, u, v_uid, false
  from unnest(v_ids) u
  where not exists (select 1 from public.task_assignees ta where ta.task_id = p_task_id and ta.user_id = u);

  if p_primary_id is not null and p_primary_id = any (v_ids) then
    -- The assignee trigger demotes the previous primary.
    update public.task_assignees set is_primary = true
    where task_id = p_task_id and user_id = p_primary_id and not is_primary;
  end if;
end;
$$;

revoke all on function public.get_client_contacts(uuid) from public, anon;
revoke all on function public.create_task(uuid, text, uuid[], uuid, uuid, text, public.task_status, public.priority_level,
  public.task_type, date, date, date, numeric) from public, anon;
revoke all on function public.set_task_assignees(uuid, uuid[], uuid) from public, anon;
grant execute on function public.get_client_contacts(uuid) to authenticated;
grant execute on function public.create_task(uuid, text, uuid[], uuid, uuid, text, public.task_status, public.priority_level,
  public.task_type, date, date, date, numeric) to authenticated;
grant execute on function public.set_task_assignees(uuid, uuid[], uuid) to authenticated;

revoke all on function
  private.track_task_completion(),
  private.set_task_schedule_default(),
  private.ensure_default_project(),
  private.protect_default_project(),
  private.send_daily_reminders(timestamptz, boolean)
from public, anon, authenticated;
grant execute on function private.is_member_default_project(uuid), private.is_own_created_task(uuid), private.my_team()
  to authenticated;
revoke all on function private.is_member_default_project(uuid), private.is_own_created_task(uuid), private.my_team()
  from public, anon;
