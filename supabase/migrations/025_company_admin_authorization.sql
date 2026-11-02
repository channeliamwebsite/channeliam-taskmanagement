-- =============================================================================
-- 025_company_admin_authorization.sql   (permission change: super admins are
-- company-level for TaskManagement; additive policies, redefined helpers)
--
-- Decided 2026-10-30: SUPER_ADMIN is a company-level role. A super admin views
-- and manages TaskManagement data in every workspace without being a member of
-- it. Workspace membership keeps deciding everything for ADMIN and INDIVIDUAL.
--
-- One helper decides company-level power: private.is_company_admin() - an
-- active SUPER_ADMIN, read from public.profiles inside the database (never from
-- the browser). It is deliberately separate from private.is_super_admin() (024),
-- which only gates company-wide attendance viewing; neither calls the other, so
-- changing one never widens the other. Restricted HR data and operations are
-- not reachable through either helper. MFA enforcement is a later migration.
--
-- Membership helpers are unchanged and stay membership-only:
--   private.my_workspace_ids, is_workspace_member, workspace_peer_ids,
--   is_active_workspace_member.
-- Role helpers gain one explicit company-level branch:
--   private.has_workspace_role(ws, roles): when roles include SUPER_ADMIN, a
--     company admin passes; otherwise the 002 rule (role + membership) applies
--     unchanged, so ADMIN and INDIVIDUAL checks are exactly as before.
--   private.is_workspace_super_admin(ws): company admin and the workspace
--     exists. Every policy built on it (workspace settings and members,
--     project edit/delete, task delete, client delete, meeting links and
--     records, activity) now works company-wide for super admins.
--   private.accessible_task_ids(), can_manage_task(), can_view_project():
--     the super-admin branch no longer requires membership.
-- Read policies that use membership helpers directly get a company-admin
-- policy alongside (existing policies are not changed): workspaces,
-- workspace_members, profiles, clients, projects, tasks, meeting_links,
-- activity_logs. The super-admin profile edit policy becomes company-wide.
-- public.daily_tracking accepts a company admin. A super admin may file a bug
-- report in any workspace.
--
-- Unchanged on purpose:
--   * workspace deletion stays impossible for signed-in users (023);
--   * super admins still do not submit daily reports (012) and still need
--     membership to check in (024, decided 2026-10-30);
--   * the last-active-super-admin guards (015, 021) and history guards (016);
--   * assignees and project owners must be active members of the workspace
--     (003); records stay in the workspace of their project or parent (003/004).
--
-- New workspaces no longer add their creator as a member when the creator is a
-- super admin (decided 2026-10-30). Existing memberships are not touched.
--
-- Audit: changes a super admin makes in any workspace are recorded by the
-- existing activity triggers (003/017) with the caller as actor. Company-level
-- events without a workspace are added in 026.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Company-level helper
-- -----------------------------------------------------------------------------
create or replace function private.is_company_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.current_user_role() = 'SUPER_ADMIN', false)
$$;

-- -----------------------------------------------------------------------------
-- Role helpers (membership helpers are unchanged)
-- -----------------------------------------------------------------------------
create or replace function private.has_workspace_role(p_workspace_id uuid, p_roles public.user_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select ('SUPER_ADMIN' = any (p_roles) and private.is_company_admin())
      or (private.current_user_role() = any (p_roles) and private.is_workspace_member(p_workspace_id))
$$;

create or replace function private.is_workspace_super_admin(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_company_admin()
     and exists (select 1 from public.workspaces w where w.id = p_workspace_id)
$$;

-- Same as 004, except the super-admin branch covers every workspace.
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

-- Same as 002, except a company admin manages every task.
create or replace function private.can_manage_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    join public.projects pr on pr.id = t.project_id
    where t.id = p_task_id
      and (
        private.is_company_admin()
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

-- Same as 002, except a company admin can view every project.
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

-- -----------------------------------------------------------------------------
-- New workspaces: a super admin creator is not made a member
-- -----------------------------------------------------------------------------
create or replace function private.add_workspace_creator()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.created_by is not null and not exists (
    select 1 from public.profiles p where p.id = new.created_by and p.role = 'SUPER_ADMIN'
  ) then
    insert into public.workspace_members (workspace_id, user_id, can_create_projects)
    values (new.id, new.created_by, true)
    on conflict (workspace_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Company-wide read policies (alongside the existing membership policies)
-- -----------------------------------------------------------------------------
drop policy if exists "workspaces: company admins read all" on public.workspaces;
create policy "workspaces: company admins read all"
  on public.workspaces for select to authenticated
  using ((select private.is_company_admin()));

drop policy if exists "workspace_members: company admins read all" on public.workspace_members;
create policy "workspace_members: company admins read all"
  on public.workspace_members for select to authenticated
  using ((select private.is_company_admin()));

drop policy if exists "profiles: company admins read all" on public.profiles;
create policy "profiles: company admins read all"
  on public.profiles for select to authenticated
  using ((select private.is_company_admin()));

drop policy if exists "clients: company admins read all" on public.clients;
create policy "clients: company admins read all"
  on public.clients for select to authenticated
  using ((select private.is_company_admin()));

-- Tasks: also lets a super admin's INSERT ... RETURNING see the new row (the
-- 002 creator clause requires membership).
drop policy if exists "tasks: company admins read all" on public.tasks;
create policy "tasks: company admins read all"
  on public.tasks for select to authenticated
  using ((select private.is_company_admin()));

drop policy if exists "projects: company admins read all" on public.projects;
create policy "projects: company admins read all"
  on public.projects for select to authenticated
  using ((select private.is_company_admin()));

drop policy if exists "meeting_links: company admins read all" on public.meeting_links;
create policy "meeting_links: company admins read all"
  on public.meeting_links for select to authenticated
  using ((select private.is_company_admin()));

drop policy if exists "activity_logs: company admins read all" on public.activity_logs;
create policy "activity_logs: company admins read all"
  on public.activity_logs for select to authenticated
  using ((select private.is_company_admin()));

-- A super admin may file a bug report in any workspace (still for themselves, OPEN).
drop policy if exists "bug_reports: company admins submit their own" on public.bug_reports;
create policy "bug_reports: company admins submit their own"
  on public.bug_reports for insert to authenticated
  with check (
    reported_by = (select auth.uid())
    and status = 'OPEN'
    and (select private.is_company_admin())
  );

-- Super admins manage employee profiles company-wide. The 003/004 trigger
-- still limits role, status, department, job title, team and manager changes
-- to super admins and stops them changing their own role or status.
drop policy if exists "profiles: update self or as workspace super admin" on public.profiles;
drop policy if exists "profiles: update self or as company admin" on public.profiles;
create policy "profiles: update self or as company admin"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.is_company_admin()))
  with check (id = (select auth.uid()) or (select private.is_company_admin()));

-- -----------------------------------------------------------------------------
-- daily_tracking: members of the workspace, or a company admin
-- (copied from 011; only the access check changes)
-- -----------------------------------------------------------------------------
create or replace function public.daily_tracking(p_workspace_id uuid)
returns table (
  user_id uuid,
  task_id uuid,
  title text,
  status text,
  priority text,
  project_name text,
  client_name text,
  scheduled_date date,
  due_date date,
  completed_at timestamptz,
  assigned_at timestamptz,
  morning_status text,
  tracking text,
  morning_generated_at timestamptz,
  evening_submitted_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_tz text;
  v_day date;
  v_all boolean;
begin
  -- Members of the workspace, or a company-level super admin (025).
  if v_uid is null or p_workspace_id is null
     or not (private.is_active_workspace_member(p_workspace_id, v_uid) or private.is_company_admin()) then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  v_tz := private.workspace_timezone(p_workspace_id);
  v_day := (now() at time zone v_tz)::date;
  v_all := private.has_workspace_role(p_workspace_id, array['SUPER_ADMIN', 'ADMIN']::public.user_role[]);

  return query
  with people as (
    select wm.user_id as uid
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id and (v_all or wm.user_id = v_uid)
  ),
  report as (
    select r.user_id as uid, r.morning_snapshot, r.morning_generated_at, r.evening_submitted_at
    from public.daily_reports r
    where r.workspace_id = p_workspace_id and r.report_date = v_day and r.user_id in (select uid from people)
  ),
  morning as (
    select rp.uid, (e ->> 'id')::uuid as tid, e ->> 'status' as m_status, e ->> 'title' as m_title,
           e ->> 'priority' as m_priority, e ->> 'project_name' as m_project, e ->> 'client_name' as m_client
    from report rp
    cross join lateral jsonb_array_elements(coalesce(rp.morning_snapshot -> 'tasks', '[]'::jsonb)) e
    where rp.morning_snapshot is not null
  ),
  live as (
    select p.uid, i.*
    from people p
    cross join lateral private.daily_task_items(p_workspace_id, p.uid, v_day, v_tz) i
  )
  select l.uid, l.task_id, l.title, l.status, l.priority, l.project_name, l.client_name,
         l.scheduled_date, l.due_date, l.completed_at, l.assigned_at,
         m.m_status,
         case when m.tid is not null then 'MORNING'
              when rp.morning_snapshot is null then 'CURRENT'
              when l.status = 'COMPLETED' and l.completed_at <= rp.morning_generated_at then 'COMPLETED_EARLY'
              when tc.created_at > rp.morning_generated_at then 'ADDED'
              when l.assigned_at > rp.morning_generated_at then 'ASSIGNED'
              else 'MOVED_IN' end,
         rp.morning_generated_at, rp.evening_submitted_at
  from live l
  join public.tasks tc on tc.id = l.task_id
  left join morning m on m.uid = l.uid and m.tid = l.task_id
  left join report rp on rp.uid = l.uid
  union all
  select m.uid, m.tid, coalesce(t.title, m.m_title), t.status::text, coalesce(t.priority::text, m.m_priority),
         coalesce(pr.name, m.m_project), coalesce(c.name, pr.client_name, m.m_client),
         t.scheduled_date, t.due_date, t.completed_at,
         (select ta.assigned_at from public.task_assignees ta where ta.task_id = m.tid and ta.user_id = m.uid),
         m.m_status,
         case when t.id is null then 'REMOVED'
              when not exists (select 1 from public.task_assignees ta where ta.task_id = m.tid and ta.user_id = m.uid) then 'REASSIGNED'
              else 'CHANGED' end,
         rp.morning_generated_at, rp.evening_submitted_at
  from morning m
  join report rp on rp.uid = m.uid
  left join public.tasks t on t.id = m.tid
  left join public.projects pr on pr.id = t.project_id
  left join public.clients c on c.id = pr.client_id
  where not exists (select 1 from live l where l.uid = m.uid and l.task_id = m.tid);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges (same pattern as 002: helpers callable by signed-in users only)
-- -----------------------------------------------------------------------------
revoke all on function private.is_company_admin() from public, anon;
grant execute on function private.is_company_admin() to authenticated;
revoke all on function public.daily_tracking(uuid) from public, anon;
grant execute on function public.daily_tracking(uuid) to authenticated;
