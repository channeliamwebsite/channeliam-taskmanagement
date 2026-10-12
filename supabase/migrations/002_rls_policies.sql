-- =============================================================================
-- 002_rls_policies.sql
-- Row Level Security: helper functions, table grants and policies.
--
-- Access model
--   * Every check is scoped to workspaces the caller belongs to.
--   * Inactive profiles (is_active = false) get no access.
--   * SUPER_ADMIN: everything inside their workspaces.
--   * ADMIN: all projects in their workspaces; tasks they created, are assigned
--     to, assigned to others, or that live in projects they own/created.
--   * INDIVIDUAL: tasks they are assigned to (plus subtasks and parent chain),
--     their own time entries, reports and notifications.
--
-- Recursion safety
--   Policies never query an RLS-protected table directly. They call
--   SECURITY DEFINER helpers in the `private` schema (owned by postgres, which
--   bypasses RLS). `private` is not exposed through the Data API, so the
--   helpers cannot be invoked as RPCs.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

-- Role of the calling user, or null when unauthenticated / inactive.
create or replace function private.current_user_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

-- Workspaces the calling (active) user belongs to.
create or replace function private.my_workspace_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select wm.workspace_id
  from public.workspace_members wm
  join public.profiles p on p.id = wm.user_id and p.is_active
  where wm.user_id = (select auth.uid())
$$;

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.my_workspace_ids() w where w = p_workspace_id
  )
$$;

create or replace function private.has_workspace_role(p_workspace_id uuid, p_roles public.user_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.current_user_role() = any (p_roles)
     and private.is_workspace_member(p_workspace_id)
$$;

create or replace function private.is_workspace_super_admin(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_workspace_role(p_workspace_id, array['SUPER_ADMIN']::public.user_role[])
$$;

-- Users that share at least one workspace with the caller (including the caller).
create or replace function private.workspace_peer_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct wm.user_id
  from public.workspace_members wm
  where wm.workspace_id in (select private.my_workspace_ids())
$$;

-- All task ids the caller may read. Used as `id in (select ...)`, which
-- Postgres evaluates once per statement (hashed subplan), not once per row.
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
    -- SUPER_ADMIN: every task in their workspaces
    select t.id
    from public.tasks t
    join ws on ws.workspace_id = t.workspace_id
    where (select role from me) = 'SUPER_ADMIN'
    union
    -- tasks the caller created
    select t.id
    from public.tasks t
    join ws on ws.workspace_id = t.workspace_id
    where t.created_by = (select uid from me)
    union
    -- tasks the caller is assigned to, or assigned to someone else
    select t.id
    from public.task_assignees ta
    join public.tasks t on t.id = ta.task_id
    join ws on ws.workspace_id = t.workspace_id
    where ta.user_id = (select uid from me) or ta.assigned_by = (select uid from me)
    union
    -- tasks in projects the caller owns or created
    select t.id
    from public.projects pr
    join ws on ws.workspace_id = pr.workspace_id
    join public.tasks t on t.project_id = pr.id
    where pr.owner_id = (select uid from me) or pr.created_by = (select uid from me)
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

-- Projects the caller may read.
create or replace function private.can_view_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and private.is_workspace_member(pr.workspace_id)
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
$$;

-- Full edit rights on a task (and its assignees / dependencies).
create or replace function private.can_manage_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.projects pr on pr.id = t.project_id
    where t.id = p_task_id
      and private.is_workspace_member(t.workspace_id)
      and (
        private.current_user_role() = 'SUPER_ADMIN'
        or (
          private.current_user_role() = 'ADMIN'
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

create or replace function private.is_task_assignee(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.task_assignees ta
    where ta.task_id = p_task_id and ta.user_id = (select auth.uid())
  )
$$;

-- ADMIN / SUPER_ADMIN may create tasks in any project of their workspaces.
create or replace function private.can_create_task_in_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.projects pr
    where pr.id = p_project_id
      and private.has_workspace_role(pr.workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[])
  )
$$;

create or replace function private.can_create_project(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_workspace_super_admin(p_workspace_id)
      or (
        private.current_user_role() = 'ADMIN'
        and exists (
          select 1 from public.workspace_members wm
          where wm.workspace_id = p_workspace_id
            and wm.user_id = (select auth.uid())
            and wm.can_create_projects
        )
      )
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS on every application table
-- -----------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects          enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_assignees    enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_comments     enable row level security;
alter table public.task_attachments  enable row level security;
alter table public.activity_logs     enable row level security;
alter table public.notifications     enable row level security;
alter table public.time_entries      enable row level security;
alter table public.daily_reports     enable row level security;

-- -----------------------------------------------------------------------------
-- Table privileges (defence in depth on top of RLS)
--   * anon gets nothing.
--   * UPDATE is limited to the columns a client may legitimately change, so
--     ownership / scoping columns (user_id, workspace_id, created_by, ...) are
--     immutable from the client even where a policy would allow the row.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, avatar_url, department, job_title, role, is_active)
  on public.profiles to authenticated;                       -- role / is_active guarded by trigger (003)

grant select, insert, delete on public.workspaces to authenticated;
grant update (name, description) on public.workspaces to authenticated;

grant select, insert, delete on public.workspace_members to authenticated;
grant update (can_create_projects) on public.workspace_members to authenticated;

grant select, insert, delete on public.projects to authenticated;
grant update (name, description, client_name, status, priority, start_date, due_date, owner_id)
  on public.projects to authenticated;

grant select, insert, delete on public.tasks to authenticated;
grant update (parent_task_id, title, description, status, priority, task_type,
              start_date, due_date, estimated_hours, progress)
  on public.tasks to authenticated;                          -- INDIVIDUAL narrowed further by trigger (003)

grant select, insert, delete on public.task_assignees to authenticated;
grant update (is_primary) on public.task_assignees to authenticated;

grant select, insert, delete on public.task_dependencies to authenticated;
grant update (dependency_type) on public.task_dependencies to authenticated;

grant select, insert, delete on public.task_comments to authenticated;
grant update (comment) on public.task_comments to authenticated;

grant select, insert, delete on public.task_attachments to authenticated;

grant select on public.activity_logs to authenticated;       -- written only by triggers / service role

grant select, delete on public.notifications to authenticated; -- created only by triggers / service role
grant update (is_read) on public.notifications to authenticated;

grant select, insert, delete on public.time_entries to authenticated;
grant update (started_at, ended_at, description) on public.time_entries to authenticated;

grant select, insert, delete on public.daily_reports to authenticated;
grant update (report_date, tasks_completed, tasks_in_progress, tasks_blocked, total_hours,
              accomplishments, blockers, tomorrow_plan)
  on public.daily_reports to authenticated;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy "profiles: read self and workspace peers"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select private.workspace_peer_ids())
  );

create policy "profiles: update self or as workspace super admin"
  on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    or (
      (select private.current_user_role()) = 'SUPER_ADMIN'
      and id in (select private.workspace_peer_ids())
    )
  )
  with check (
    id = (select auth.uid())
    or (
      (select private.current_user_role()) = 'SUPER_ADMIN'
      and id in (select private.workspace_peer_ids())
    )
  );
-- No INSERT policy: profiles are created by the auth trigger.
-- No DELETE policy: deleting the auth user cascades.

-- -----------------------------------------------------------------------------
-- workspaces
-- -----------------------------------------------------------------------------
create policy "workspaces: members can read"
  on public.workspaces for select to authenticated
  using (
    id in (select private.my_workspace_ids())
    -- lets INSERT ... RETURNING succeed before the creator membership exists
    or (created_by = (select auth.uid()) and (select private.current_user_role()) = 'SUPER_ADMIN')
  );

create policy "workspaces: super admins can create"
  on public.workspaces for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.current_user_role()) = 'SUPER_ADMIN'
  );

create policy "workspaces: super admins can update"
  on public.workspaces for update to authenticated
  using (private.is_workspace_super_admin(id))
  with check (private.is_workspace_super_admin(id));

create policy "workspaces: super admins can delete"
  on public.workspaces for delete to authenticated
  using (private.is_workspace_super_admin(id));

-- -----------------------------------------------------------------------------
-- workspace_members
-- -----------------------------------------------------------------------------
create policy "workspace_members: members can read their workspaces"
  on public.workspace_members for select to authenticated
  using (workspace_id in (select private.my_workspace_ids()));

create policy "workspace_members: super admins can add"
  on public.workspace_members for insert to authenticated
  with check (private.is_workspace_super_admin(workspace_id));

create policy "workspace_members: super admins can update"
  on public.workspace_members for update to authenticated
  using (private.is_workspace_super_admin(workspace_id))
  with check (private.is_workspace_super_admin(workspace_id));

create policy "workspace_members: super admins can remove"
  on public.workspace_members for delete to authenticated
  using (private.is_workspace_super_admin(workspace_id));

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create policy "projects: read accessible"
  on public.projects for select to authenticated
  using (
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
  );

create policy "projects: permitted users can create"
  on public.projects for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.can_create_project(workspace_id)
  );

create policy "projects: super admins and owning admins can update"
  on public.projects for update to authenticated
  using (
    private.is_workspace_super_admin(workspace_id)
    or (
      private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[])
      and (owner_id = (select auth.uid()) or created_by = (select auth.uid()))
    )
  )
  with check (
    private.is_workspace_super_admin(workspace_id)
    or private.has_workspace_role(workspace_id, array['ADMIN']::public.user_role[])
  );

create policy "projects: super admins can delete"
  on public.projects for delete to authenticated
  using (private.is_workspace_super_admin(workspace_id));

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create policy "tasks: read accessible"
  on public.tasks for select to authenticated
  using (
    id in (select private.accessible_task_ids())
    -- lets INSERT ... RETURNING see the row it just created
    or (created_by = (select auth.uid()) and workspace_id in (select private.my_workspace_ids()))
  );

-- parent_task_id is validated by trigger (must exist in the same project), so
-- nested trees can be inserted in a single statement.
create policy "tasks: admins create in their workspace projects"
  on public.tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.can_create_task_in_project(project_id)
  );

-- Assignees may update; INDIVIDUAL assignees are limited to status/progress by trigger.
create policy "tasks: managers and assignees can update"
  on public.tasks for update to authenticated
  using (private.can_manage_task(id) or private.is_task_assignee(id))
  with check (private.can_manage_task(id) or private.is_task_assignee(id));

create policy "tasks: super admins and creators can delete"
  on public.tasks for delete to authenticated
  using (
    private.is_workspace_super_admin(workspace_id)
    or (created_by = (select auth.uid()) and private.can_manage_task(id))
  );

-- -----------------------------------------------------------------------------
-- task_assignees
-- -----------------------------------------------------------------------------
create policy "task_assignees: read on accessible tasks"
  on public.task_assignees for select to authenticated
  using (task_id in (select private.accessible_task_ids()));

-- Assignee must be an active member of the task's workspace (enforced by trigger).
create policy "task_assignees: task managers can assign"
  on public.task_assignees for insert to authenticated
  with check (
    assigned_by = (select auth.uid())
    and private.can_manage_task(task_id)
  );

create policy "task_assignees: task managers can update"
  on public.task_assignees for update to authenticated
  using (private.can_manage_task(task_id))
  with check (private.can_manage_task(task_id));

create policy "task_assignees: task managers can unassign"
  on public.task_assignees for delete to authenticated
  using (private.can_manage_task(task_id));

-- -----------------------------------------------------------------------------
-- task_dependencies
-- -----------------------------------------------------------------------------
create policy "task_dependencies: read on accessible tasks"
  on public.task_dependencies for select to authenticated
  using (task_id in (select private.accessible_task_ids()));

create policy "task_dependencies: task managers can create"
  on public.task_dependencies for insert to authenticated
  with check (
    private.can_manage_task(task_id)
    and depends_on_task_id in (select private.accessible_task_ids())
  );

create policy "task_dependencies: task managers can update"
  on public.task_dependencies for update to authenticated
  using (private.can_manage_task(task_id))
  with check (private.can_manage_task(task_id));

create policy "task_dependencies: task managers can delete"
  on public.task_dependencies for delete to authenticated
  using (private.can_manage_task(task_id));

-- -----------------------------------------------------------------------------
-- task_comments
-- -----------------------------------------------------------------------------
create policy "task_comments: read on accessible tasks"
  on public.task_comments for select to authenticated
  using (task_id in (select private.accessible_task_ids()));

create policy "task_comments: comment on accessible tasks"
  on public.task_comments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and task_id in (select private.accessible_task_ids())
  );

create policy "task_comments: authors can edit"
  on public.task_comments for update to authenticated
  using (user_id = (select auth.uid()) and task_id in (select private.accessible_task_ids()))
  with check (user_id = (select auth.uid()));

create policy "task_comments: authors and task managers can delete"
  on public.task_comments for delete to authenticated
  using (
    (user_id = (select auth.uid()) and task_id in (select private.accessible_task_ids()))
    or private.can_manage_task(task_id)
  );

-- -----------------------------------------------------------------------------
-- task_attachments
-- -----------------------------------------------------------------------------
create policy "task_attachments: read on accessible tasks"
  on public.task_attachments for select to authenticated
  using (task_id in (select private.accessible_task_ids()));

create policy "task_attachments: upload on accessible tasks"
  on public.task_attachments for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and task_id in (select private.accessible_task_ids())
  );

create policy "task_attachments: uploaders and task managers can delete"
  on public.task_attachments for delete to authenticated
  using (
    (uploaded_by = (select auth.uid()) and task_id in (select private.accessible_task_ids()))
    or private.can_manage_task(task_id)
  );

-- -----------------------------------------------------------------------------
-- activity_logs (read-only for clients)
-- -----------------------------------------------------------------------------
create policy "activity_logs: read relevant events"
  on public.activity_logs for select to authenticated
  using (
    workspace_id in (select private.my_workspace_ids())
    and (
      private.is_workspace_super_admin(workspace_id)
      or user_id = (select auth.uid())
      or task_id in (select private.accessible_task_ids())
      or (task_id is null and project_id is not null and private.can_view_project(project_id))
    )
  );

-- -----------------------------------------------------------------------------
-- notifications (recipient only)
-- -----------------------------------------------------------------------------
create policy "notifications: recipients can read"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy "notifications: recipients can mark read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "notifications: recipients can delete"
  on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- time_entries
-- -----------------------------------------------------------------------------
create policy "time_entries: own entries, or admins on accessible tasks"
  on public.time_entries for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      (select private.current_user_role()) in ('SUPER_ADMIN', 'ADMIN')
      and task_id in (select private.accessible_task_ids())
    )
  );

create policy "time_entries: log time on accessible tasks"
  on public.time_entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and task_id in (select private.accessible_task_ids())
  );

create policy "time_entries: owners can update"
  on public.time_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "time_entries: owners can delete"
  on public.time_entries for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- daily_reports
-- -----------------------------------------------------------------------------
create policy "daily_reports: own reports, or admins of the workspace"
  on public.daily_reports for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_workspace_role(workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[])
  );

create policy "daily_reports: members submit their own"
  on public.daily_reports for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_workspace_member(workspace_id)
  );

create policy "daily_reports: owners can update"
  on public.daily_reports for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "daily_reports: owners can delete"
  on public.daily_reports for delete to authenticated
  using (user_id = (select auth.uid()));
