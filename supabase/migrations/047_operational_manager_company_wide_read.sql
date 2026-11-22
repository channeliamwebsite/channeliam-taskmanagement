-- =============================================================================
-- 047_operational_manager_company_wide_read.sql
--
-- Phase 2 (personal workspaces). Found by actually running 041-046 against a
-- real database and exercising the flows (not just checking that the SQL
-- applied): every SELECT policy in this schema follows the same shape --
-- "is_company_admin() [Super Admin] OR is_workspace_member() AND ..." -- and
-- Operational Manager, who is deliberately never added to a department
-- workspace's membership, fell through every one of them. In practice an
-- Operational Manager could create and assign a task, then immediately lose
-- the ability to see it, update it, or even list the workspace's other
-- members to assign to -- the write-side migrations (044/045) were useless
-- without this. The final spec's "Monitor company-wide work progress" for
-- Operational Manager requires exactly this company-wide read.
--
-- Scoped narrowly: the bypass only ever applies to a workspace where
-- is_personal = false, so it never reaches another Operational Manager's own
-- personal workspace -- that isolation (043) is preserved. An Operational
-- Manager's own personal workspace is already visible through ordinary
-- membership (they are its sole member via add_workspace_creator), so no
-- separate branch is needed for that case.
-- =============================================================================

create or replace function private.is_operational_manager_in_department(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.current_user_role() = 'OPERATIONAL_MANAGER'
     and exists (select 1 from public.workspaces w where w.id = p_workspace_id and not w.is_personal)
$$;

drop policy "workspaces: members can read" on public.workspaces;
create policy "workspaces: members can read"
  on public.workspaces for select to authenticated
  using (
    id in (select private.my_workspace_ids())
    or (private.current_user_role() = 'OPERATIONAL_MANAGER' and not is_personal)
    -- lets INSERT ... RETURNING succeed before the creator membership exists
    or (created_by = (select auth.uid()) and (select private.current_user_role()) = 'SUPER_ADMIN')
  );

drop policy "workspace_members: members can read their workspaces" on public.workspace_members;
create policy "workspace_members: members can read their workspaces"
  on public.workspace_members for select to authenticated
  using (
    workspace_id in (select private.my_workspace_ids())
    or private.is_operational_manager_in_department(workspace_id)
  );

drop policy "projects: read accessible" on public.projects;
create policy "projects: read accessible"
  on public.projects for select to authenticated
  using (
    (
      workspace_id in (select private.my_workspace_ids())
      and (
        (select private.current_user_role()) in ('SUPER_ADMIN', 'ADMIN')
        or owner_id = (select auth.uid())
        or created_by = (select auth.uid())
        or id in (
          select t.project_id from public.tasks t
          where t.id in (select private.accessible_task_ids())
        )
      )
    )
    or private.is_operational_manager_in_department(workspace_id)
  );

create or replace function private.can_view_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and (
        private.is_company_admin()
        or private.is_operational_manager_in_department(pr.workspace_id)
        or (
          private.is_workspace_member(pr.workspace_id)
          and (
            private.current_user_role() in ('SUPER_ADMIN', 'ADMIN')
            or pr.owner_id = (select auth.uid())
            or pr.created_by = (select auth.uid())
            or exists (
              select 1 from public.tasks t
              where t.project_id = pr.id
                and t.id in (select private.accessible_task_ids())
            )
          )
        )
      )
  )
$$;

-- accessible_task_ids (030's active definition), reproduced in full with one
-- new union branch added for Operational Manager; every other branch,
-- including the recursive descendant/ancestor expansion, is byte-for-byte
-- unchanged.
create or replace function private.accessible_task_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  with recursive
  me as (
    select (select auth.uid()) as uid, private.current_user_role() as role
  ),
  ws as (
    select private.my_workspace_ids() as workspace_id
  ),
  base as (
    select t.id
    from public.tasks t
    where private.is_company_admin()
    union
    select t.id
    from public.tasks t
    where (select role from me) = 'OPERATIONAL_MANAGER'
      and exists (select 1 from public.workspaces w where w.id = t.workspace_id and not w.is_personal)
    union
    select t.id
    from public.tasks t
    join ws on ws.workspace_id = t.workspace_id
    where t.created_by = (select uid from me)
    union
    select t.id
    from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
    join ws on ws.workspace_id = t.workspace_id
    where ta.user_id = (select uid from me) or ta.assigned_by = (select uid from me)
    union
    select t.id
    from public.projects pr
    join ws on ws.workspace_id = pr.workspace_id
    join public.tasks t on t.project_id = pr.id
    where pr.owner_id = (select uid from me) or pr.created_by = (select uid from me)
    union
    -- tasks assigned to the caller's direct reports (team lead view)
    select t.id
    from public.profiles rep
    join public.task_assignees ta on ta.user_id = rep.id
    join public.tasks t on t.id = ta.task_id
    join ws on ws.workspace_id = t.workspace_id
    where rep.manager_id = (select uid from me)
      and (select role from me) in ('SUPER_ADMIN', 'ADMIN')
    union
    -- 030: collaborators see the tasks of their projects assigned to them
    select t.id
    from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
    join public.project_collaborators pc on pc.project_id = t.project_id and pc.user_id = ta.user_id
    where ta.user_id = (select uid from me)
  ),
  descendants as (
    select id from base
    union
    select t.id from public.tasks t join descendants d on t.parent_task_id = d.id
  ),
  ancestors as (
    select t.parent_task_id as id
    from public.tasks t join base b on b.id = t.id
    where t.parent_task_id is not null
    union
    select t.parent_task_id
    from public.tasks t join ancestors a on t.id = a.id
    where t.parent_task_id is not null
  )
  select id from descendants
  where (select role from me) is not null
  union
  select id from ancestors
  where (select role from me) is not null
$$;
