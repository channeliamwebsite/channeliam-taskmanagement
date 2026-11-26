-- 053: Super Admin dashboard company-wide task aggregates, computed in the
-- database instead of fetching every task into the app (Phase 3 performance
-- work, finding #1). Four functions mirror the four pure calculators in
-- src/lib/super-admin-overview.ts exactly:
--   - company_task_status_counts     <-> statusCounts (always all-time)
--   - company_employee_task_counts   <-> employeePerformance (per active,
--     non-super-admin employee; optional date range)
--   - company_department_task_counts <-> departmentProgress (per department;
--     a task shared by two assignees in the same department is counted once)
--   - company_project_task_counts    <-> projectProgress (per project;
--     last_update deliberately uses a WIDER task set than the other columns
--     -- see its own comment below)
--
-- All four are SECURITY INVOKER (RLS decides visibility exactly as the old
-- per-row reads did -- same rule as 037's project_task_counts): a Super
-- Admin's "tasks: company admins read all" / "task_assignees: read on
-- accessible tasks" (-> accessible_task_ids()'s is_company_admin() branch)
-- and an Operational Manager's dedicated accessible_task_ids() branch
-- (047) and "profiles: operational managers read department members" (048)
-- already grant the company-wide read these functions need; no new policy.
--
-- "Leaf task" (one piece of work) matches src/lib/data/tasks.ts's
-- subtaskCounts()/toSummary() exactly: a task is a leaf when no OTHER
-- non-cancelled task names it as parent_task_id. Verified equivalent to
-- subtaskCounts()'s "subtaskTotal = count of non-cancelled direct children"
-- (subtaskTotal == 0 iff the task is not in `parents` below) for every case
-- checked, including a task whose only child is cancelled (both treat it as
-- a leaf) and a cancelled intermediate node (both ignore it and look no
-- further). Same CTE shape as 037's project_task_counts, scoped by
-- workspace instead of project.
--
-- Zero-task employees/departments/projects: deliberately NOT handled here.
-- Each function returns a row only for an entity with >=1 matching task
-- (sparse, same convention project_task_counts already established), and
-- the TypeScript layer (super-admin-overview.ts's new *FromCounts
-- functions) merges these rows into its own members/projects-driven list,
-- defaulting a missing entity to zero -- exactly how projects.ts's
-- toSummary already defaults a project project_task_counts never returned a
-- row for.

-- -----------------------------------------------------------------------------
-- A. company_task_status_counts: always all-time (statusCounts has no date
-- range on the dashboard; "All time" is the default filter).
-- -----------------------------------------------------------------------------
create or replace function public.company_task_status_counts(p_workspace_ids uuid[], p_today date)
returns table (
  total integer, completed integer, in_progress integer, pending integer, blocked integer, overdue integer
)
language sql stable security invoker set search_path = ''
as $$
  with visible as materialized (
    select t.id, t.status, t.parent_task_id, t.due_date
    from public.tasks t
    where t.workspace_id = any (p_workspace_ids) and t.status <> 'CANCELLED'
  ),
  parents as (
    select distinct parent_task_id as id from visible where parent_task_id is not null
  ),
  leaf as (
    select v.* from visible v where not exists (select 1 from parents p where p.id = v.id)
  )
  select
    count(*)::integer as total,
    count(*) filter (where status = 'COMPLETED')::integer as completed,
    count(*) filter (where status in ('IN_PROGRESS', 'IN_REVIEW'))::integer as in_progress,
    count(*) filter (where status = 'TODO')::integer as pending,
    count(*) filter (where status = 'BLOCKED')::integer as blocked,
    count(*) filter (where due_date is not null and due_date < p_today and status not in ('COMPLETED', 'CANCELLED'))::integer as overdue
  from leaf
$$;

comment on function public.company_task_status_counts(uuid[], date) is
  'Company-wide, all-time leaf-task status counts for the given department workspaces (RLS applies). Mirrors src/lib/super-admin-overview.ts statusCounts.';

revoke all on function public.company_task_status_counts(uuid[], date) from public, anon;
grant execute on function public.company_task_status_counts(uuid[], date) to authenticated;

-- -----------------------------------------------------------------------------
-- B. company_employee_task_counts: one row per employee with >=1 matching
-- leaf task (sparse); optional date range (null = all time).
-- -----------------------------------------------------------------------------
create or replace function public.company_employee_task_counts(
  p_workspace_ids uuid[], p_today date, p_timezone text, p_range_from date default null, p_range_to date default null
)
returns table (
  user_id uuid, total integer, completed integer, in_progress integer, pending integer, blocked integer, overdue integer
)
language sql stable security invoker set search_path = ''
as $$
  with visible as materialized (
    select t.id, t.status, t.parent_task_id, t.due_date, t.scheduled_date, t.completed_at
    from public.tasks t
    where t.workspace_id = any (p_workspace_ids) and t.status <> 'CANCELLED'
  ),
  parents as (
    select distinct parent_task_id as id from visible where parent_task_id is not null
  ),
  leaf as (
    select v.* from visible v where not exists (select 1 from parents p where p.id = v.id)
  ),
  ranged as (
    select l.* from leaf l
    where p_range_from is null
       or l.due_date between p_range_from and p_range_to
       or l.scheduled_date between p_range_from and p_range_to
       or (l.completed_at is not null and (l.completed_at at time zone p_timezone)::date between p_range_from and p_range_to)
  )
  select
    ta.user_id,
    count(*)::integer as total,
    count(*) filter (where r.status = 'COMPLETED')::integer as completed,
    count(*) filter (where r.status in ('IN_PROGRESS', 'IN_REVIEW'))::integer as in_progress,
    count(*) filter (where r.status = 'TODO')::integer as pending,
    count(*) filter (where r.status = 'BLOCKED')::integer as blocked,
    count(*) filter (where r.due_date is not null and r.due_date < p_today and r.status not in ('COMPLETED', 'CANCELLED'))::integer as overdue
  from ranged r
  join public.task_assignees ta on ta.task_id = r.id
  -- Mirrors employeePerformance's `members.filter(isActive && role !== 'SUPER_ADMIN')`.
  join public.profiles p on p.id = ta.user_id and p.is_active and p.role <> 'SUPER_ADMIN'
  group by ta.user_id
$$;

comment on function public.company_employee_task_counts(uuid[], date, text, date, date) is
  'Per active, non-super-admin employee leaf-task status counts (RLS applies; sparse -- no row for an employee with none). Mirrors src/lib/super-admin-overview.ts employeePerformance.';

revoke all on function public.company_employee_task_counts(uuid[], date, text, date, date) from public, anon;
grant execute on function public.company_employee_task_counts(uuid[], date, text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- C. company_department_task_counts: one row per department with >=1
-- matching leaf task (sparse); a task shared by two assignees in the same
-- department is counted once (count(distinct ...)), and can appear in more
-- than one department's totals when its assignees span departments.
-- "employees" per department is intentionally not returned: the app already
-- has the member list cheaply and computes it from there, unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.company_department_task_counts(
  p_workspace_ids uuid[], p_timezone text, p_range_from date default null, p_range_to date default null
)
returns table (department text, total integer, completed integer)
language sql stable security invoker set search_path = ''
as $$
  with visible as materialized (
    select t.id, t.status, t.parent_task_id, t.due_date, t.scheduled_date, t.completed_at
    from public.tasks t
    where t.workspace_id = any (p_workspace_ids) and t.status <> 'CANCELLED'
  ),
  parents as (
    select distinct parent_task_id as id from visible where parent_task_id is not null
  ),
  leaf as (
    select v.* from visible v where not exists (select 1 from parents p where p.id = v.id)
  ),
  ranged as (
    select l.* from leaf l
    where p_range_from is null
       or l.due_date between p_range_from and p_range_to
       or l.scheduled_date between p_range_from and p_range_to
       or (l.completed_at is not null and (l.completed_at at time zone p_timezone)::date between p_range_from and p_range_to)
  )
  select
    coalesce(nullif(trim(p.team), ''), 'No department') as department,
    count(distinct r.id)::integer as total,
    count(distinct r.id) filter (where r.status = 'COMPLETED')::integer as completed
  from ranged r
  join public.task_assignees ta on ta.task_id = r.id
  join public.profiles p on p.id = ta.user_id and p.is_active and p.role <> 'SUPER_ADMIN'
  group by 1
$$;

comment on function public.company_department_task_counts(uuid[], text, date, date) is
  'Per-department leaf-task status counts, active non-super-admin assignees only (RLS applies; sparse). Mirrors src/lib/super-admin-overview.ts departmentProgress.';

revoke all on function public.company_department_task_counts(uuid[], text, date, date) from public, anon;
grant execute on function public.company_department_task_counts(uuid[], text, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- D. company_project_task_counts: one row per project with >=1 in-range task
-- of ANY kind (sparse, driven by `updates` below -- a superset of the leaf
-- set, since ranged_leaf is a subset of ranged_all). last_update
-- deliberately comes from that wider set: projectProgress's own
-- `updates = list.map(t => t.updatedAt)` is NOT countable-filtered, so a
-- project whose only in-range task is cancelled (or a parent with subtasks)
-- still gets total=0/next_due=null/assignees={} but a real last_update.
-- assignees is alphabetically ordered (array_agg ... order by) for
-- deterministic output, matching projectProgress's `[...names].sort(...)`.
-- -----------------------------------------------------------------------------
create or replace function public.company_project_task_counts(
  p_workspace_ids uuid[], p_today date, p_timezone text, p_range_from date default null, p_range_to date default null
)
returns table (
  project_id uuid, total integer, completed integer, in_progress integer, pending integer, blocked integer,
  overdue integer, next_due date, last_update timestamptz, assignees text[]
)
language sql stable security invoker set search_path = ''
as $$
  with visible as materialized (
    select t.id, t.project_id, t.status, t.parent_task_id, t.due_date, t.scheduled_date, t.completed_at
    from public.tasks t
    where t.workspace_id = any (p_workspace_ids) and t.status <> 'CANCELLED'
  ),
  parents as (
    select distinct parent_task_id as id from visible where parent_task_id is not null
  ),
  leaf as (
    select v.* from visible v where not exists (select 1 from parents p where p.id = v.id)
  ),
  ranged_leaf as (
    select l.* from leaf l
    where p_range_from is null
       or l.due_date between p_range_from and p_range_to
       or l.scheduled_date between p_range_from and p_range_to
       or (l.completed_at is not null and (l.completed_at at time zone p_timezone)::date between p_range_from and p_range_to)
  ),
  -- Wider than `leaf`: every task in scope (parents-with-subtasks and
  -- cancelled tasks included), same date-range rule -- for last_update only.
  ranged_all as (
    select t.project_id, t.updated_at
    from public.tasks t
    where t.workspace_id = any (p_workspace_ids)
      and (
        p_range_from is null
        or t.due_date between p_range_from and p_range_to
        or t.scheduled_date between p_range_from and p_range_to
        or (t.completed_at is not null and (t.completed_at at time zone p_timezone)::date between p_range_from and p_range_to)
      )
  ),
  counts as (
    select
      r.project_id,
      count(*)::integer as total,
      count(*) filter (where r.status = 'COMPLETED')::integer as completed,
      count(*) filter (where r.status in ('IN_PROGRESS', 'IN_REVIEW'))::integer as in_progress,
      count(*) filter (where r.status = 'TODO')::integer as pending,
      count(*) filter (where r.status = 'BLOCKED')::integer as blocked,
      count(*) filter (where r.due_date is not null and r.due_date < p_today and r.status not in ('COMPLETED', 'CANCELLED'))::integer as overdue,
      min(r.due_date) filter (where r.status <> 'COMPLETED' and r.due_date is not null) as next_due
    from ranged_leaf r
    group by r.project_id
  ),
  names as (
    select
      r.project_id,
      array_agg(
        distinct coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Unknown')
        order by coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'Unknown')
      ) as assignees
    from ranged_leaf r
    join public.task_assignees ta on ta.task_id = r.id
    join public.profiles p on p.id = ta.user_id
    group by r.project_id
  ),
  updates as (
    select project_id, max(updated_at) as last_update from ranged_all group by project_id
  )
  select
    u.project_id,
    coalesce(c.total, 0) as total,
    coalesce(c.completed, 0) as completed,
    coalesce(c.in_progress, 0) as in_progress,
    coalesce(c.pending, 0) as pending,
    coalesce(c.blocked, 0) as blocked,
    coalesce(c.overdue, 0) as overdue,
    c.next_due,
    u.last_update,
    coalesce(n.assignees, '{}'::text[]) as assignees
  from updates u
  left join counts c on c.project_id = u.project_id
  left join names n on n.project_id = u.project_id
$$;

comment on function public.company_project_task_counts(uuid[], date, text, date, date) is
  'Per-project leaf-task status counts plus next_due/last_update/assignees (RLS applies; sparse). last_update uses every in-range task, not only leaf ones. Mirrors src/lib/super-admin-overview.ts projectProgress.';

revoke all on function public.company_project_task_counts(uuid[], date, text, date, date) from public, anon;
grant execute on function public.company_project_task_counts(uuid[], date, text, date, date) to authenticated;
