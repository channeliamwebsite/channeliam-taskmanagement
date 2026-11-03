-- =============================================================================
-- 017_admin_audit_trail.sql   (additive: enum values, one nullable column,
-- triggers; no data or permission changes)
--
-- Extends the existing activity log (001/003) instead of adding a second log.
-- Already recorded before this migration: task created / status / priority /
-- progress / due date / schedule / completed, assignee added or removed,
-- comments, attachments, project created and project status changes.
--
-- Added here, all written by AFTER triggers in the same transaction as the
-- change itself, so a refused or rolled-back change leaves no entry:
--   EMPLOYEE_ROLE_CHANGED, EMPLOYEE_DEACTIVATED, EMPLOYEE_REACTIVATED,
--   EMPLOYEE_UPDATED (department, job title, team, manager)
--   MEMBER_ADDED, MEMBER_REMOVED, MEMBER_PERMISSION_CHANGED (can_create_projects)
--   CLIENT_CREATED, CLIENT_UPDATED, CLIENT_DELETED
--   PROJECT_UPDATED (existing, unused until now), PROJECT_DELETED
--   TASK_DELETED, TASK_REASSIGNED (existing, unused: primary assignee changed)
--
-- Actor: always auth.uid() of the signed-in caller, read inside the database
-- (private.log_activity / log_audit); never a value sent by the browser.
-- Changes made without a user (service role, SQL editor) are recorded with no
-- actor, shown as "System".
--
-- Details: names, roles, statuses, dates and ids only. No passwords, tokens or
-- keys exist in these tables; client contact details and project descriptions
-- are recorded as "changed", never by value.
--
-- Protection (unchanged): authenticated users have SELECT only on
-- activity_logs (002) and no insert/update/delete policy, so entries cannot be
-- forged, edited or deleted through the API. Reads follow the existing policy:
-- super admins of the workspace see everything; others see their own actions
-- and task/project events they can access. Employee, membership, client and
-- deletion entries have no task or project, so only super admins (and the
-- actor) see them, and they do not appear in the existing task/project feeds.
-- PROJECT_UPDATED and TASK_REASSIGNED do appear there, to people who can
-- already see that project or task.
--
-- Profile changes are company-wide; they are recorded once in each workspace
-- the employee belongs to, so that workspace's super admins can review them.
-- A person in no workspace produces no profile entry.
--
-- References: target_user_id is ON DELETE SET NULL like user_id. Deleting a
-- profile with history is refused by 016. Entries for a workspace are deleted
-- with the workspace (existing cascade). Events fired by such cascades
-- (workspace, project or profile being deleted) are not recorded, because the
-- rows they would reference are gone.
--
-- Storage: a few rows per administrative change; no retention job is added.
-- =============================================================================

alter type public.activity_action add value if not exists 'TASK_DELETED';
alter type public.activity_action add value if not exists 'PROJECT_DELETED';
alter type public.activity_action add value if not exists 'CLIENT_CREATED';
alter type public.activity_action add value if not exists 'CLIENT_UPDATED';
alter type public.activity_action add value if not exists 'CLIENT_DELETED';
alter type public.activity_action add value if not exists 'MEMBER_ADDED';
alter type public.activity_action add value if not exists 'MEMBER_REMOVED';
alter type public.activity_action add value if not exists 'MEMBER_PERMISSION_CHANGED';
alter type public.activity_action add value if not exists 'EMPLOYEE_ROLE_CHANGED';
alter type public.activity_action add value if not exists 'EMPLOYEE_DEACTIVATED';
alter type public.activity_action add value if not exists 'EMPLOYEE_REACTIVATED';
alter type public.activity_action add value if not exists 'EMPLOYEE_UPDATED';

-- The employee an administrative action was about (null for other events).
alter table public.activity_logs
  add column target_user_id uuid references public.profiles (id) on delete set null;
create index activity_logs_target_user_idx on public.activity_logs (target_user_id) where target_user_id is not null;

create or replace function private.log_audit(
  p_workspace_id uuid,
  p_project_id uuid,
  p_target_user_id uuid,
  p_action public.activity_action,
  p_old jsonb default null,
  p_new jsonb default null
)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.activity_logs (workspace_id, user_id, project_id, target_user_id, action, old_value, new_value)
  values (p_workspace_id, (select auth.uid()), p_project_id, p_target_user_id, p_action, p_old, p_new);
$$;

-- -----------------------------------------------------------------------------
-- Employees: role, active status and organisation fields
-- -----------------------------------------------------------------------------
create or replace function private.log_profile_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws uuid;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
begin
  if new.department is distinct from old.department then
    v_old := v_old || jsonb_build_object('department', old.department);
    v_new := v_new || jsonb_build_object('department', new.department);
  end if;
  if new.job_title is distinct from old.job_title then
    v_old := v_old || jsonb_build_object('job_title', old.job_title);
    v_new := v_new || jsonb_build_object('job_title', new.job_title);
  end if;
  if new.team is distinct from old.team then
    v_old := v_old || jsonb_build_object('team', old.team);
    v_new := v_new || jsonb_build_object('team', new.team);
  end if;
  if new.manager_id is distinct from old.manager_id then
    v_old := v_old || jsonb_build_object('manager_id', old.manager_id);
    v_new := v_new || jsonb_build_object('manager_id', new.manager_id);
  end if;

  for v_ws in select wm.workspace_id from public.workspace_members wm where wm.user_id = new.id loop
    if new.role is distinct from old.role then
      perform private.log_audit(v_ws, null, new.id, 'EMPLOYEE_ROLE_CHANGED',
        jsonb_build_object('role', old.role), jsonb_build_object('role', new.role));
    end if;
    if new.is_active is distinct from old.is_active then
      perform private.log_audit(v_ws, null, new.id,
        case when new.is_active then 'EMPLOYEE_REACTIVATED' else 'EMPLOYEE_DEACTIVATED' end::public.activity_action);
    end if;
    if v_new <> '{}'::jsonb then
      perform private.log_audit(v_ws, null, new.id, 'EMPLOYEE_UPDATED', v_old, v_new);
    end if;
  end loop;
  return null;
end;
$$;

create trigger log_profile_audit after update of role, is_active, department, job_title, team, manager_id on public.profiles
  for each row execute function private.log_profile_audit();

-- -----------------------------------------------------------------------------
-- Workspace membership
-- -----------------------------------------------------------------------------
create or replace function private.log_member_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(new.workspace_id, null, new.user_id, 'MEMBER_ADDED', null,
      jsonb_build_object('can_create_projects', new.can_create_projects));
  elsif tg_op = 'DELETE' then
    -- Cascades from a deleted workspace or profile: nothing left to reference.
    if not exists (select 1 from public.workspaces where id = old.workspace_id)
       or not exists (select 1 from public.profiles where id = old.user_id) then
      return null;
    end if;
    perform private.log_audit(old.workspace_id, null, old.user_id, 'MEMBER_REMOVED');
  elsif new.can_create_projects is distinct from old.can_create_projects then
    perform private.log_audit(new.workspace_id, null, new.user_id, 'MEMBER_PERMISSION_CHANGED',
      jsonb_build_object('can_create_projects', old.can_create_projects),
      jsonb_build_object('can_create_projects', new.can_create_projects));
  end if;
  return null;
end;
$$;

create trigger log_member_audit after insert or update or delete on public.workspace_members
  for each row execute function private.log_member_audit();

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------
create or replace function private.log_client_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(new.workspace_id, null, null, 'CLIENT_CREATED', null,
      jsonb_build_object('client_id', new.id, 'name', new.name));
  elsif tg_op = 'DELETE' then
    if not exists (select 1 from public.workspaces where id = old.workspace_id) then
      return null;
    end if;
    perform private.log_audit(old.workspace_id, null, null, 'CLIENT_DELETED',
      jsonb_build_object('client_id', old.id, 'name', old.name), null);
  else
    if new.name is distinct from old.name then
      v_old := v_old || jsonb_build_object('name', old.name);
      v_new := v_new || jsonb_build_object('name', new.name);
    end if;
    if new.is_active is distinct from old.is_active then
      v_old := v_old || jsonb_build_object('is_active', old.is_active);
      v_new := v_new || jsonb_build_object('is_active', new.is_active);
    end if;
    if (new.contact_name, new.contact_email) is distinct from (old.contact_name, old.contact_email) then
      v_new := v_new || jsonb_build_object('contact_changed', true);
    end if;
    if new.notes is distinct from old.notes then
      v_new := v_new || jsonb_build_object('notes_changed', true);
    end if;
    if v_new <> '{}'::jsonb then
      perform private.log_audit(new.workspace_id, null, null, 'CLIENT_UPDATED',
        v_old || jsonb_build_object('client_id', new.id), v_new || jsonb_build_object('client_id', new.id));
    end if;
  end if;
  return null;
end;
$$;

create trigger log_client_audit after insert or update or delete on public.clients
  for each row execute function private.log_client_audit();

-- -----------------------------------------------------------------------------
-- Projects: existing created / status entries, plus other edits and deletion
-- -----------------------------------------------------------------------------
create or replace function private.log_project_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(new.workspace_id, null, new.id, 'PROJECT_CREATED', null,
      jsonb_build_object('name', new.name, 'status', new.status));
    return null;
  end if;

  if new.status is distinct from old.status then
    perform private.log_activity(new.workspace_id, null, new.id, 'PROJECT_STATUS_CHANGED',
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;

  if new.name is distinct from old.name then
    v_old := v_old || jsonb_build_object('name', old.name);
    v_new := v_new || jsonb_build_object('name', new.name);
  end if;
  if new.client_id is distinct from old.client_id then
    v_old := v_old || jsonb_build_object('client_id', old.client_id);
    v_new := v_new || jsonb_build_object('client_id', new.client_id);
  end if;
  if new.owner_id is distinct from old.owner_id then
    v_old := v_old || jsonb_build_object('owner_id', old.owner_id);
    v_new := v_new || jsonb_build_object('owner_id', new.owner_id);
  end if;
  if new.priority is distinct from old.priority then
    v_old := v_old || jsonb_build_object('priority', old.priority);
    v_new := v_new || jsonb_build_object('priority', new.priority);
  end if;
  if new.start_date is distinct from old.start_date then
    v_old := v_old || jsonb_build_object('start_date', old.start_date);
    v_new := v_new || jsonb_build_object('start_date', new.start_date);
  end if;
  if new.due_date is distinct from old.due_date then
    v_old := v_old || jsonb_build_object('due_date', old.due_date);
    v_new := v_new || jsonb_build_object('due_date', new.due_date);
  end if;
  if new.description is distinct from old.description then
    v_new := v_new || jsonb_build_object('description_changed', true);
  end if;
  if v_new <> '{}'::jsonb then
    perform private.log_activity(new.workspace_id, null, new.id, 'PROJECT_UPDATED', v_old, v_new);
  end if;
  return null;
end;
$$;

create or replace function private.log_project_deleted()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.workspaces where id = old.workspace_id) then
    return null; -- the whole workspace is being deleted
  end if;
  -- project_id is left empty: the project row no longer exists.
  perform private.log_audit(old.workspace_id, null, null, 'PROJECT_DELETED',
    jsonb_build_object('project_id', old.id, 'name', old.name, 'client_id', old.client_id), null);
  return null;
end;
$$;

create trigger log_project_deleted after delete on public.projects
  for each row execute function private.log_project_deleted();

-- -----------------------------------------------------------------------------
-- Tasks: deletion and primary-assignee changes
-- -----------------------------------------------------------------------------
create or replace function private.log_task_deleted()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Removed with its workspace, project or parent task: that deletion is the event.
  if not exists (select 1 from public.workspaces where id = old.workspace_id)
     or not exists (select 1 from public.projects where id = old.project_id)
     or (old.parent_task_id is not null and not exists (select 1 from public.tasks where id = old.parent_task_id)) then
    return null;
  end if;
  -- Recorded without task/project links (super admins and the actor read it),
  -- so project viewers do not see titles of tasks they could not access.
  perform private.log_audit(old.workspace_id, null, null, 'TASK_DELETED',
    jsonb_build_object('task_id', old.id, 'title', old.title, 'status', old.status, 'project_id', old.project_id), null);
  return null;
end;
$$;

create trigger log_task_deleted after delete on public.tasks
  for each row execute function private.log_task_deleted();

create or replace function private.log_primary_assignee()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  if not (new.is_primary and not old.is_primary) then
    return null;
  end if;
  select * into v_task from public.tasks where id = new.task_id;
  if not found then
    return null;
  end if;
  perform private.log_activity(v_task.workspace_id, v_task.id, v_task.project_id, 'TASK_REASSIGNED', null,
    jsonb_build_object('user_id', new.user_id, 'is_primary', true));
  return null;
end;
$$;

create trigger log_primary_assignee after update of is_primary on public.task_assignees
  for each row execute function private.log_primary_assignee();

-- Trigger functions and helpers are not meant to be called directly.
revoke all on function
  private.log_audit(uuid, uuid, uuid, public.activity_action, jsonb, jsonb),
  private.log_profile_audit(),
  private.log_member_audit(),
  private.log_client_audit(),
  private.log_project_activity(),
  private.log_project_deleted(),
  private.log_task_deleted(),
  private.log_primary_assignee()
from public, anon, authenticated;
