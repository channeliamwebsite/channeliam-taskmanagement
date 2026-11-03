-- =============================================================================
-- 026_company_audit_events.sql   (additive: enum values, one relaxed NOT NULL,
-- triggers; no data or permission changes)
--
-- Since 025 super admins act company-wide. Two kinds of company-level change
-- had no audit entry:
--   * workspace settings: creating a workspace and changing its name,
--     description or timezone were not recorded at all;
--   * employee changes (role, active status, department, job title, team,
--     manager) were recorded once per workspace the employee belongs to (017),
--     so an employee in no workspace produced no entry.
--
-- Changes:
--   1. activity_action gains WORKSPACE_CREATED and WORKSPACE_UPDATED, recorded
--      by an AFTER trigger on public.workspaces in the workspace itself.
--   2. activity_logs.workspace_id may be null, only for company-level events
--      that belong to no workspace: an employee change for someone in no
--      workspace is now recorded once with no workspace. Rows with a workspace
--      are unchanged; existing rows are untouched.
--
-- Visibility: entries without a workspace are readable only by company admins
-- ("activity_logs: company admins read all", 025); the 002 policy requires a
-- workspace the reader belongs to. Entries stay read-only for everyone
-- (SELECT-only grant, 002): they cannot be forged, edited or deleted.
-- Actor: auth.uid() read in the database (private.log_audit, 017).
-- =============================================================================

alter type public.activity_action add value if not exists 'WORKSPACE_CREATED';
alter type public.activity_action add value if not exists 'WORKSPACE_UPDATED';

alter table public.activity_logs alter column workspace_id drop not null;
comment on column public.activity_logs.workspace_id is
  'Workspace of the event. Null only for company-level events that belong to no workspace (026), readable by super admins only.';

-- -----------------------------------------------------------------------------
-- Employees: as 017, plus one entry without a workspace when the employee
-- belongs to none.
-- -----------------------------------------------------------------------------
create or replace function private.log_profile_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws uuid;
  v_workspaces uuid[];
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

  select array_agg(wm.workspace_id) into v_workspaces
  from public.workspace_members wm where wm.user_id = new.id;
  -- No workspace: one company-level entry (workspace_id null).
  foreach v_ws in array coalesce(v_workspaces, array[null::uuid]) loop
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

-- -----------------------------------------------------------------------------
-- Workspace settings
-- -----------------------------------------------------------------------------
create or replace function private.log_workspace_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.log_audit(new.id, null, null, 'WORKSPACE_CREATED', null,
      jsonb_build_object('name', new.name, 'timezone', new.timezone));
    return null;
  end if;
  if new.name is distinct from old.name then
    v_old := v_old || jsonb_build_object('name', old.name);
    v_new := v_new || jsonb_build_object('name', new.name);
  end if;
  if new.timezone is distinct from old.timezone then
    v_old := v_old || jsonb_build_object('timezone', old.timezone);
    v_new := v_new || jsonb_build_object('timezone', new.timezone);
  end if;
  -- Descriptions are recorded as changed, not by value (as client details in 017).
  if new.description is distinct from old.description then
    v_new := v_new || jsonb_build_object('description', 'changed');
  end if;
  if v_new <> '{}'::jsonb then
    perform private.log_audit(new.id, null, null, 'WORKSPACE_UPDATED', v_old, v_new);
  end if;
  return null;
end;
$$;

create trigger log_workspace_audit after insert or update of name, description, timezone on public.workspaces
  for each row execute function private.log_workspace_audit();

revoke all on function private.log_workspace_audit() from public, anon, authenticated;
