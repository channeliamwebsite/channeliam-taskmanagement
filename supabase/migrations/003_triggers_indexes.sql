-- =============================================================================
-- 003_triggers_indexes.sql
-- Triggers (integrity, timestamps, auth -> profile, activity log, notifications)
-- and indexes.
--
-- Trigger functions live in `private` and run as SECURITY DEFINER so their
-- internal lookups/writes are not blocked by the caller's RLS. They only touch
-- rows directly related to the row being written.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.projects
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.task_comments
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.daily_reports
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Auth -> profiles
-- -----------------------------------------------------------------------------
-- Creates the profile for a new auth user. Never overwrites an existing profile
-- and never trusts user-supplied metadata for the role (signup metadata is
-- client-controlled): every new user starts as INDIVIDUAL.
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')), ''),
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keeps profiles.email in sync with the auth email; touches nothing else.
create or replace function private.handle_user_email_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Only a SUPER_ADMIN may change role / is_active / department / job_title, and
-- never their own role or active flag (prevents accidental lock-out).
-- Calls without a user (service role, SQL editor, auth server) are trusted.
create or replace function private.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return new;
  end if;

  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'Profile id and email cannot be changed directly' using errcode = '42501';
  end if;

  if (new.role, new.is_active, new.department, new.job_title)
     is distinct from (old.role, old.is_active, old.department, old.job_title) then
    if private.current_user_role() is distinct from 'SUPER_ADMIN' then
      raise exception 'Only a super admin can change role, active status, department or job title'
        using errcode = '42501';
    end if;
    if old.id = v_uid and (new.role, new.is_active) is distinct from (old.role, old.is_active) then
      raise exception 'Super admins cannot change their own role or deactivate themselves'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_profile_update before update on public.profiles
  for each row execute function private.guard_profile_update();

-- -----------------------------------------------------------------------------
-- Workspaces: creator becomes a member
-- -----------------------------------------------------------------------------
create or replace function private.add_workspace_creator()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.workspace_members (workspace_id, user_id, can_create_projects)
    values (new.id, new.created_by, true)
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger add_workspace_creator after insert on public.workspaces
  for each row execute function private.add_workspace_creator();

-- -----------------------------------------------------------------------------
-- Integrity helpers
-- -----------------------------------------------------------------------------
create or replace function private.is_active_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    join public.profiles p on p.id = wm.user_id
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and p.is_active
  )
$$;

-- -----------------------------------------------------------------------------
-- Projects: owner must belong to the workspace; workspace is fixed
-- -----------------------------------------------------------------------------
create or replace function private.validate_project()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'A project cannot be moved to another workspace' using errcode = '23514';
  end if;

  if new.owner_id is not null
     and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and not private.is_active_workspace_member(new.workspace_id, new.owner_id) then
    raise exception 'Project owner must be an active member of the workspace' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger validate_project before insert or update on public.projects
  for each row execute function private.validate_project();

-- -----------------------------------------------------------------------------
-- Tasks: workspace derivation, hierarchy rules, INDIVIDUAL column guard
-- -----------------------------------------------------------------------------
create or replace function private.validate_task()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_parent_project uuid;
begin
  if tg_op = 'INSERT' then
    select pr.workspace_id into new.workspace_id
    from public.projects pr where pr.id = new.project_id;
  else
    if new.project_id is distinct from old.project_id then
      raise exception 'A task cannot be moved to another project' using errcode = '23514';
    end if;
    new.workspace_id := old.workspace_id;

    -- Top-level client updates by non-managers (INDIVIDUAL assignees) may only
    -- touch status and progress. Nested trigger updates (e.g. actual_hours
    -- sync) and trusted server calls are exempt.
    if pg_trigger_depth() = 1
       and (select auth.uid()) is not null
       and not private.can_manage_task(old.id)
       and (new.parent_task_id, new.title, new.description, new.priority, new.task_type,
            new.start_date, new.due_date, new.estimated_hours, new.actual_hours, new.created_by)
           is distinct from
           (old.parent_task_id, old.title, old.description, old.priority, old.task_type,
            old.start_date, old.due_date, old.estimated_hours, old.actual_hours, old.created_by) then
      raise exception 'Assignees without manage rights may only update status and progress'
        using errcode = '42501';
    end if;
  end if;

  if new.parent_task_id is not null
     and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id) then
    select t.project_id into v_parent_project
    from public.tasks t where t.id = new.parent_task_id;

    if v_parent_project is distinct from new.project_id then
      raise exception 'Parent task must belong to the same project' using errcode = '23514';
    end if;

    -- Reject cycles: the new parent must not be this task or one of its descendants.
    if tg_op = 'UPDATE' and exists (
      with recursive ancestors as (
        select new.parent_task_id as id
        union
        select t.parent_task_id
        from public.tasks t join ancestors a on t.id = a.id
        where t.parent_task_id is not null
      )
      select 1 from ancestors where id = new.id
    ) then
      raise exception 'Task hierarchy cannot contain cycles' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_task before insert or update on public.tasks
  for each row execute function private.validate_task();

-- -----------------------------------------------------------------------------
-- Task assignees: assignee must be an active member of the task's workspace;
-- setting a new primary demotes the previous one.
-- -----------------------------------------------------------------------------
create or replace function private.validate_task_assignee()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if tg_op = 'UPDATE' and (new.task_id, new.user_id) is distinct from (old.task_id, old.user_id) then
    raise exception 'Reassign by removing and adding assignees' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    select t.workspace_id into v_workspace_id from public.tasks t where t.id = new.task_id;
    if not private.is_active_workspace_member(v_workspace_id, new.user_id) then
      raise exception 'Assignee must be an active member of the task''s workspace' using errcode = '23514';
    end if;
  end if;

  if new.is_primary then
    update public.task_assignees
    set is_primary = false
    where task_id = new.task_id and user_id <> new.user_id and is_primary;
  end if;

  return new;
end;
$$;

create trigger validate_task_assignee before insert or update on public.task_assignees
  for each row execute function private.validate_task_assignee();

-- -----------------------------------------------------------------------------
-- Task dependencies: same workspace, no cycles
-- -----------------------------------------------------------------------------
create or replace function private.validate_task_dependency()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.task_id, new.depends_on_task_id) is distinct from (old.task_id, old.depends_on_task_id) then
    raise exception 'Dependency endpoints cannot be changed; delete and recreate instead' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if (select workspace_id from public.tasks where id = new.task_id)
       is distinct from (select workspace_id from public.tasks where id = new.depends_on_task_id) then
      raise exception 'Dependent tasks must be in the same workspace' using errcode = '23514';
    end if;

    if exists (
      with recursive chain as (
        select new.depends_on_task_id as id
        union
        select d.depends_on_task_id
        from public.task_dependencies d join chain c on d.task_id = c.id
      )
      select 1 from chain where id = new.task_id
    ) then
      raise exception 'Task dependencies cannot contain cycles' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger validate_task_dependency before insert or update on public.task_dependencies
  for each row execute function private.validate_task_dependency();

-- -----------------------------------------------------------------------------
-- Time entries: derive duration, keep tasks.actual_hours in sync
-- -----------------------------------------------------------------------------
create or replace function private.compute_time_entry_duration()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.ended_at is null then
    new.duration_minutes := null;
  else
    new.duration_minutes := floor(extract(epoch from (new.ended_at - new.started_at)) / 60)::integer;
  end if;
  return new;
end;
$$;

create trigger compute_time_entry_duration before insert or update on public.time_entries
  for each row execute function private.compute_time_entry_duration();

create or replace function private.sync_task_actual_hours()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task_id uuid;
begin
  foreach v_task_id in array array_remove(array[
    case when tg_op <> 'DELETE' then new.task_id end,
    case when tg_op <> 'INSERT' then old.task_id end
  ], null)
  loop
    update public.tasks t
    set actual_hours = coalesce((
      select round(sum(te.duration_minutes) / 60.0, 2)
      from public.time_entries te
      where te.task_id = v_task_id
    ), 0)
    where t.id = v_task_id;
  end loop;
  return null;
end;
$$;

create trigger sync_task_actual_hours after insert or update or delete on public.time_entries
  for each row execute function private.sync_task_actual_hours();

-- -----------------------------------------------------------------------------
-- Notifications: read_at follows is_read
-- -----------------------------------------------------------------------------
create or replace function private.set_notification_read_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.is_read and not old.is_read then
    new.read_at := now();
  elsif not new.is_read then
    new.read_at := null;
  end if;
  return new;
end;
$$;

create trigger set_notification_read_at before update on public.notifications
  for each row execute function private.set_notification_read_at();

-- -----------------------------------------------------------------------------
-- Activity log
-- -----------------------------------------------------------------------------
create or replace function private.log_activity(
  p_workspace_id uuid,
  p_task_id uuid,
  p_project_id uuid,
  p_action public.activity_action,
  p_old jsonb default null,
  p_new jsonb default null
)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.activity_logs (workspace_id, user_id, task_id, project_id, action, old_value, new_value)
  values (p_workspace_id, (select auth.uid()), p_task_id, p_project_id, p_action, p_old, p_new);
$$;

create or replace function private.log_task_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'TASK_CREATED', null,
      jsonb_build_object('title', new.title, 'status', new.status, 'priority', new.priority,
                         'parent_task_id', new.parent_task_id));
    return null;
  end if;

  if new.status is distinct from old.status then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'STATUS_CHANGED',
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
    if new.status = 'COMPLETED' then
      perform private.log_activity(new.workspace_id, new.id, new.project_id, 'TASK_COMPLETED', null, null);
    end if;
  end if;

  if new.priority is distinct from old.priority then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'PRIORITY_CHANGED',
      jsonb_build_object('priority', old.priority), jsonb_build_object('priority', new.priority));
  end if;

  if new.progress is distinct from old.progress then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'PROGRESS_CHANGED',
      jsonb_build_object('progress', old.progress), jsonb_build_object('progress', new.progress));
  end if;

  if new.due_date is distinct from old.due_date then
    perform private.log_activity(new.workspace_id, new.id, new.project_id, 'DUE_DATE_CHANGED',
      jsonb_build_object('due_date', old.due_date), jsonb_build_object('due_date', new.due_date));
  end if;

  return null;
end;
$$;

create trigger log_task_activity after insert or update on public.tasks
  for each row execute function private.log_task_activity();

create or replace function private.log_assignee_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  -- Skip when the task itself is being deleted (cascade).
  select * into v_task from public.tasks where id = coalesce(new.task_id, old.task_id);
  if not found then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform private.log_activity(v_task.workspace_id, v_task.id, v_task.project_id, 'TASK_ASSIGNED', null,
      jsonb_build_object('user_id', new.user_id, 'is_primary', new.is_primary));
  else
    perform private.log_activity(v_task.workspace_id, v_task.id, v_task.project_id, 'TASK_UNASSIGNED',
      jsonb_build_object('user_id', old.user_id, 'is_primary', old.is_primary), null);
  end if;
  return null;
end;
$$;

create trigger log_assignee_activity after insert or delete on public.task_assignees
  for each row execute function private.log_assignee_activity();

create or replace function private.log_comment_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = new.task_id;
  perform private.log_activity(v_task.workspace_id, v_task.id, v_task.project_id, 'COMMENT_ADDED', null,
    jsonb_build_object('comment_id', new.id));
  return null;
end;
$$;

create trigger log_comment_activity after insert on public.task_comments
  for each row execute function private.log_comment_activity();

create or replace function private.log_attachment_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  select * into v_task from public.tasks where id = new.task_id;
  perform private.log_activity(v_task.workspace_id, v_task.id, v_task.project_id, 'ATTACHMENT_UPLOADED', null,
    jsonb_build_object('attachment_id', new.id, 'file_name', new.file_name));
  return null;
end;
$$;

create trigger log_attachment_activity after insert on public.task_attachments
  for each row execute function private.log_attachment_activity();

create or replace function private.log_project_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, null, new.id, 'PROJECT_CREATED', null,
      jsonb_build_object('name', new.name, 'status', new.status));
  elsif new.status is distinct from old.status then
    perform private.log_activity(new.workspace_id, null, new.id, 'PROJECT_STATUS_CHANGED',
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return null;
end;
$$;

create trigger log_project_activity after insert or update on public.projects
  for each row execute function private.log_project_activity();

-- -----------------------------------------------------------------------------
-- Notifications (assignment + comments). Due-date reminders belong in a
-- scheduled job / server code, not a row trigger.
-- -----------------------------------------------------------------------------
create or replace function private.notify_task_assigned()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_assigner text;
begin
  if new.user_id is not distinct from new.assigned_by then
    return null;  -- self-assignment
  end if;

  select * into v_task from public.tasks where id = new.task_id;
  select coalesce(nullif(p.full_name, ''), p.email) into v_assigner
  from public.profiles p where p.id = new.assigned_by;

  insert into public.notifications (user_id, type, title, message, task_id, project_id)
  values (
    new.user_id,
    'TASK_ASSIGNED',
    'You have been assigned a new task.',
    format('%s assigned you "%s".', coalesce(v_assigner, 'Someone'), v_task.title),
    v_task.id,
    v_task.project_id
  );
  return null;
end;
$$;

create trigger notify_task_assigned after insert on public.task_assignees
  for each row execute function private.notify_task_assigned();

create or replace function private.notify_task_comment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_author text;
begin
  select * into v_task from public.tasks where id = new.task_id;
  select coalesce(nullif(p.full_name, ''), p.email) into v_author
  from public.profiles p where p.id = new.user_id;

  insert into public.notifications (user_id, type, title, message, task_id, project_id)
  select r.user_id,
         'TASK_COMMENT',
         'New comment on your task.',
         format('%s commented on "%s".', coalesce(v_author, 'Someone'), v_task.title),
         v_task.id,
         v_task.project_id
  from (
    select ta.user_id from public.task_assignees ta where ta.task_id = v_task.id
    union
    select v_task.created_by
  ) r
  join public.profiles p on p.id = r.user_id and p.is_active
  where r.user_id is distinct from new.user_id;

  return null;
end;
$$;

create trigger notify_task_comment after insert on public.task_comments
  for each row execute function private.notify_task_comment();

-- Trigger functions are not meant to be called directly.
revoke all on function
  private.set_updated_at(),
  private.handle_new_user(),
  private.handle_user_email_change(),
  private.guard_profile_update(),
  private.add_workspace_creator(),
  private.validate_project(),
  private.validate_task(),
  private.validate_task_assignee(),
  private.validate_task_dependency(),
  private.compute_time_entry_duration(),
  private.sync_task_actual_hours(),
  private.set_notification_read_at(),
  private.log_activity(uuid, uuid, uuid, public.activity_action, jsonb, jsonb),
  private.log_task_activity(),
  private.log_assignee_activity(),
  private.log_comment_activity(),
  private.log_attachment_activity(),
  private.log_project_activity(),
  private.notify_task_assigned(),
  private.notify_task_comment(),
  private.is_active_workspace_member(uuid, uuid)
from public, anon, authenticated;

-- =============================================================================
-- Indexes
-- (unique constraints above already index: workspace_members(workspace_id, user_id),
--  task_assignees(task_id, user_id), task_dependencies(task_id, depends_on_task_id),
--  daily_reports(user_id, workspace_id, report_date))
-- =============================================================================

-- profiles
create index profiles_role_idx            on public.profiles (role) where is_active;
create index profiles_email_idx           on public.profiles (lower(email));

-- workspaces
create index workspaces_created_by_idx    on public.workspaces (created_by);

-- workspace_members: "which workspaces am I in" (RLS hot path)
create index workspace_members_user_id_idx on public.workspace_members (user_id, workspace_id);

-- projects: workspace lists / filters, ownership, calendar
create index projects_workspace_status_idx   on public.projects (workspace_id, status);
create index projects_workspace_priority_idx on public.projects (workspace_id, priority);
create index projects_workspace_due_date_idx on public.projects (workspace_id, due_date);
create index projects_owner_id_idx           on public.projects (owner_id);
create index projects_created_by_idx         on public.projects (created_by);

-- tasks
create index tasks_project_status_idx       on public.tasks (project_id, status);           -- project tasks / kanban columns
create index tasks_project_priority_idx     on public.tasks (project_id, priority);
create index tasks_project_start_due_idx    on public.tasks (project_id, start_date, due_date); -- timeline
create index tasks_parent_task_id_idx       on public.tasks (parent_task_id);                -- hierarchy
create index tasks_workspace_status_idx     on public.tasks (workspace_id, status);         -- admin / super admin dashboards
create index tasks_workspace_priority_idx   on public.tasks (workspace_id, priority);
create index tasks_workspace_due_date_idx   on public.tasks (workspace_id, due_date);       -- calendar
create index tasks_open_due_date_idx        on public.tasks (due_date)                       -- due-soon / overdue jobs
  where status not in ('COMPLETED', 'CANCELLED') and due_date is not null;
create index tasks_created_by_idx           on public.tasks (created_by);
create index tasks_status_idx               on public.tasks (status);

-- task_assignees: "my tasks", "tasks I assigned"
create index task_assignees_user_task_idx   on public.task_assignees (user_id, task_id);
create index task_assignees_assigned_by_idx on public.task_assignees (assigned_by);
create unique index task_assignees_one_primary_idx on public.task_assignees (task_id) where is_primary;

-- task_dependencies: reverse lookup ("what does this task block")
create index task_dependencies_depends_on_idx on public.task_dependencies (depends_on_task_id);

-- task_comments / attachments
create index task_comments_task_created_idx   on public.task_comments (task_id, created_at);
create index task_comments_user_id_idx        on public.task_comments (user_id);
create index task_attachments_task_id_idx     on public.task_attachments (task_id, created_at);
create index task_attachments_uploaded_by_idx on public.task_attachments (uploaded_by);

-- activity_logs: feeds by workspace / project / task / user, newest first
create index activity_logs_workspace_created_idx on public.activity_logs (workspace_id, created_at desc);
create index activity_logs_project_created_idx   on public.activity_logs (project_id, created_at desc);
create index activity_logs_task_created_idx      on public.activity_logs (task_id, created_at desc);
create index activity_logs_user_created_idx      on public.activity_logs (user_id, created_at desc);

-- notifications: inbox and unread badge
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx  on public.notifications (user_id) where not is_read;
create index notifications_task_id_idx      on public.notifications (task_id);
create index notifications_project_id_idx   on public.notifications (project_id);

-- time_entries: per-user timesheets, per-task totals, one running timer per user
create index time_entries_user_started_idx on public.time_entries (user_id, started_at desc);
create index time_entries_task_id_idx      on public.time_entries (task_id);
create unique index time_entries_one_running_timer_idx on public.time_entries (user_id) where ended_at is null;

-- daily_reports: team / org aggregation by date
create index daily_reports_workspace_date_idx on public.daily_reports (workspace_id, report_date desc);
create index daily_reports_user_date_idx      on public.daily_reports (user_id, report_date desc);
