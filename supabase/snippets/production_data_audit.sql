-- =============================================================================
-- PRODUCTION DATA AUDIT — READ ONLY.
--
-- Run in the Supabase dashboard SQL editor (or psql) against production. Every
-- statement is a SELECT inside a READ ONLY transaction, so nothing can change.
-- Use the output to mark each client / project / task / report / meeting as
-- KEEP or DELETE; nothing is assumed to be dummy data.
--
-- "looks_dummy" is only a hint (names or emails containing test/demo/dummy/
-- sample/e2e/qa/example/lorem). It is NOT a deletion rule.
-- =============================================================================
begin transaction read only;

-- 1. Workspaces
select w.id, w.name, w.created_at, p.email as created_by_email,
       (select count(*) from public.workspace_members m where m.workspace_id = w.id) as members
from public.workspaces w left join public.profiles p on p.id = w.created_by
order by w.created_at;

-- 2. People and memberships (the initial super admin must be KEPT)
select p.id, p.email, p.full_name, p.role, p.is_active, p.team, p.created_at,
       coalesce(string_agg(w.name, ', ' order by w.name), '(no workspace)') as workspaces,
       (p.email ~* '(test|demo|dummy|sample|e2e|example\.)') as looks_dummy
from public.profiles p
left join public.workspace_members m on m.user_id = p.id
left join public.workspaces w on w.id = m.workspace_id
group by p.id order by p.role, p.created_at;

-- 3. Clients and how many projects reference each
select c.id, c.workspace_id, c.name, c.created_at, cp.email as created_by,
       (select count(*) from public.projects pr where pr.client_id = c.id) as projects,
       (c.name ~* '(test|demo|dummy|sample|e2e|\mqa\M|lorem|example)') as looks_dummy
from public.clients c left join public.profiles cp on cp.id = c.created_by
order by c.workspace_id, c.created_at;

-- 4. Projects with everything that would be removed with them
select pr.id, pr.workspace_id, pr.name, pr.is_default, pr.status, c.name as client, pr.created_at,
       op.email as created_by,
       count(distinct t.id) as tasks,
       count(distinct t.id) filter (where t.parent_task_id is not null) as subtasks,
       count(distinct ta.id) as assignments,
       count(distinct tc.id) as comments,
       count(distinct att.id) as attachments,
       count(distinct te.id) as time_entries,
       (pr.name ~* '(test|demo|dummy|sample|e2e|\mqa\M|lorem|example)') as looks_dummy
from public.projects pr
left join public.clients c on c.id = pr.client_id
left join public.profiles op on op.id = pr.created_by
left join public.tasks t on t.project_id = pr.id
left join public.task_assignees ta on ta.task_id = t.id
left join public.task_comments tc on tc.task_id = t.id
left join public.task_attachments att on att.task_id = t.id
left join public.time_entries te on te.task_id = t.id
group by pr.id, c.name, op.email order by pr.workspace_id, pr.is_default desc, pr.created_at;

-- 5. Tasks (General-project tasks must be judged one by one)
select t.id, t.project_id, pr.name as project, pr.is_default as in_general, t.parent_task_id, t.title,
       t.status, t.created_at, cp.email as created_by,
       (select string_agg(ap.email, ', ') from public.task_assignees ta join public.profiles ap on ap.id = ta.user_id where ta.task_id = t.id) as assignees,
       (t.title ~* '(test|demo|dummy|sample|e2e|\mqa\M|lorem|example)') as looks_dummy
from public.tasks t join public.projects pr on pr.id = t.project_id
left join public.profiles cp on cp.id = t.created_by
order by pr.name, t.created_at;

-- 6. Dependency links that cross projects (deleting one side removes the link only)
select d.id, t1.title as task, p1.name as task_project, t2.title as depends_on, p2.name as depends_on_project
from public.task_dependencies d
join public.tasks t1 on t1.id = d.task_id join public.projects p1 on p1.id = t1.project_id
join public.tasks t2 on t2.id = d.depends_on_task_id join public.projects p2 on p2.id = t2.project_id
where t1.project_id <> t2.project_id;

-- 7. Daily reports per person and date range
select r.workspace_id, p.email, p.role, count(*) as reports,
       count(*) filter (where r.morning_submitted_at is not null) as morning_submitted,
       count(*) filter (where r.evening_submitted_at is not null) as evening_submitted,
       count(*) filter (where r.morning_submitted_at is null and r.evening_submitted_at is null) as snapshot_only,
       min(r.report_date) as first_date, max(r.report_date) as last_date
from public.daily_reports r join public.profiles p on p.id = r.user_id
group by r.workspace_id, p.email, p.role order by p.email;

-- 8. Meeting schedules and records
select ml.id, ml.workspace_id, ml.title, ml.kind, ml.starts_at, ml.meeting_date, ml.team, ml.is_active, ml.created_at,
       (select count(*) from public.meeting_records mr where mr.meeting_link_id = ml.id) as records
from public.meeting_links ml order by ml.created_at;
select mr.id, ml.title, mr.meeting_date, mr.status, left(mr.notes, 80) as notes_preview,
       cardinality(mr.follow_up_task_ids) as follow_ups
from public.meeting_records mr join public.meeting_links ml on ml.id = mr.meeting_link_id
order by mr.meeting_date;

-- 9. Other rows linked to tasks/projects (for completeness)
select 'notifications' as tbl, count(*) from public.notifications
union all select 'activity_logs', count(*) from public.activity_logs
union all select 'bug_reports', count(*) from public.bug_reports;

rollback;
