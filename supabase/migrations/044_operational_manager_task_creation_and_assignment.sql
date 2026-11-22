-- =============================================================================
-- 044_operational_manager_task_creation_and_assignment.sql
--
-- Phase 2 (personal workspaces). Operational Manager may create projects
-- across every department workspace and in their own personal workspace,
-- create tasks everywhere, and assign/reassign/unassign tasks across
-- departments. Super Admin is removed from project and task creation here
-- (monitoring-only); Super Admin's removal from task management/assignment
-- and project edit/delete is handled separately in 045 and 046.
--
-- private.can_manage_task is deliberately left untouched by this migration
-- (see 046): assignment gets its own helper, can_assign_task, so Operational
-- Manager's new, unrestricted assignment reach never leaks into
-- task_dependencies, task_comments or task_attachments moderation, which
-- still call can_manage_task directly.
-- =============================================================================

-- Operational Manager may create a project in any workspace at all, personal
-- or department — "across departments and in their own personal workspace"
-- collapses to one unrestricted-by-membership check.
create or replace function private.operational_manager_may_create_project(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.current_user_role() = 'OPERATIONAL_MANAGER'
     and exists (select 1 from public.workspaces w where w.id = p_workspace_id)
$$;

-- Super Admin removed (monitoring-only); Admin and Individual unchanged;
-- Operational Manager added.
create or replace function private.can_create_project(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (
      private.current_user_role() = 'ADMIN'
      and exists (
        select 1 from public.workspace_members wm
        where wm.workspace_id = p_workspace_id
          and wm.user_id = (select auth.uid())
          and wm.can_create_projects
      )
    )
    or private.individual_may_create(p_workspace_id)
    or private.operational_manager_may_create_project(p_workspace_id)
$$;

-- Super Admin removed ('SUPER_ADMIN' dropped from the role array, so
-- has_workspace_role's is_company_admin() shortcut never fires here);
-- Admin unchanged; Operational Manager added, unrestricted.
create or replace function private.can_create_task_in_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p_project_id
      and pr.status <> 'ARCHIVED'
      and (
        private.has_workspace_role(pr.workspace_id, array['ADMIN']::public.user_role[])
        or private.current_user_role() = 'OPERATIONAL_MANAGER'
      )
  )
$$;

-- Assignment-only helper. Admin's branch is copied verbatim from
-- can_manage_task's existing ownership logic (unchanged Admin behavior); an
-- unrestricted Operational Manager branch is added; there is no Super Admin
-- branch (monitoring-only).
create or replace function private.can_assign_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t join public.projects pr on pr.id = t.project_id
    where t.id = p_task_id and (
      private.current_user_role() = 'OPERATIONAL_MANAGER'
      or (
        private.is_workspace_member(t.workspace_id)
        and private.current_user_role() = 'ADMIN'
        and (
          t.created_by = (select auth.uid())
          or pr.owner_id = (select auth.uid())
          or pr.created_by = (select auth.uid())
          or exists (
            select 1 from public.task_assignees ta
            where ta.task_id = t.id
              and (ta.user_id = (select auth.uid()) or ta.assigned_by = (select auth.uid()))
          )
        )
      )
    )
  )
$$;

drop policy "task_assignees: task managers can assign" on public.task_assignees;
create policy "task_assignees: authorised assigners can assign"
  on public.task_assignees for insert to authenticated
  with check (assigned_by = (select auth.uid()) and private.can_assign_task(task_id));

drop policy "task_assignees: task managers can update" on public.task_assignees;
create policy "task_assignees: authorised assigners can update"
  on public.task_assignees for update to authenticated
  using (private.can_assign_task(task_id))
  with check (private.can_assign_task(task_id));

drop policy "task_assignees: task managers can unassign" on public.task_assignees;
create policy "task_assignees: authorised assigners can unassign"
  on public.task_assignees for delete to authenticated
  using (private.can_assign_task(task_id));

-- set_task_assignees (022's active redefinition) gated its own guard on
-- can_manage_task directly; without this fix an Operational Manager could
-- assign via a raw task_assignees INSERT (now allowed by the policy above)
-- but would be wrongly rejected by this RPC's internal check. Reproduced in
-- full from the live 022 definition with only that one guard line changed.
create or replace function public.set_task_assignees(p_task_id uuid, p_user_ids uuid[], p_primary_id uuid default null)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_expected integer;
  v_removed integer;
  v_primary uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.can_assign_task(p_task_id) then
    raise exception 'You don''t have permission to assign this task' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct u), '{}') into v_ids from unnest(p_user_ids) u where u is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Assign at least one person' using errcode = '23514';
  end if;

  -- Additions first, so replacing everyone never leaves the task unassigned.
  insert into public.task_assignees (task_id, user_id, assigned_by, is_primary)
  select p_task_id, u, v_uid, false
  from unnest(v_ids) u
  where not exists (select 1 from public.task_assignees ta where ta.task_id = p_task_id and ta.user_id = u);

  select count(*) into v_expected
  from public.task_assignees ta
  where ta.task_id = p_task_id and not (ta.user_id = any (v_ids));

  delete from public.task_assignees ta
  where ta.task_id = p_task_id and not (ta.user_id = any (v_ids));
  get diagnostics v_removed = row_count;
  if v_removed <> v_expected then
    raise exception 'You don''t have permission to remove some assignees' using errcode = '42501';
  end if;

  -- The requested primary, else the current one, else the first of the list.
  v_primary := case when p_primary_id = any (v_ids) then p_primary_id end;
  if v_primary is null and not exists (
    select 1 from public.task_assignees ta where ta.task_id = p_task_id and ta.is_primary
  ) then
    v_primary := v_ids[1];
  end if;
  if v_primary is not null then
    -- The assignee trigger demotes the previous primary.
    update public.task_assignees set is_primary = true
    where task_id = p_task_id and user_id = v_primary and not is_primary;
  end if;
end;
$$;

-- validate_task_parent_access (018): extend the "own created task" nesting
-- rule from Individual-only to also cover Operational Manager, so an
-- Operational Manager can add subtasks under a task they personally
-- created. Reproduced in full from the live 018 definition with only the
-- role-check line changed; can_manage_task's branch is untouched.
create or replace function private.validate_task_parent_access()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.parent_task_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_task_id is not distinct from old.parent_task_id then
    return new;
  end if;
  if private.can_manage_task(new.parent_task_id)
     or (
       private.current_user_role() = any (array['INDIVIDUAL', 'OPERATIONAL_MANAGER']::public.user_role[])
       and private.is_own_created_task(new.parent_task_id)
     ) then
    return new;
  end if;
  raise exception 'You can only add subtasks to tasks you manage.' using errcode = '42501';
end;
$$;
