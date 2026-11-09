-- =============================================================================
-- VERIFY FULL RESET - READ ONLY. Run after production-full-reset.sql (COMMIT)
-- AND the Auth / Storage cleanup. Every line should say PASS.
-- =============================================================================
begin read only;

with expected as (select unnest(array['super-admin-1@example.com', 'super-admin-2@example.com']) as email),
keep as (select u.id from auth.users u join expected e on lower(u.email) = lower(e.email)),
checks(check_name, ok, detail) as (
  select 'exactly the 2 Super Admin Auth users', (select count(*) from auth.users) = 2 and (select count(*) from keep) = 2, (select count(*) from auth.users)::text
  union all select 'remaining Auth users are the Super Admin emails', (select count(*) from keep) = 2, (select string_agg(email, ', ' order by email) from auth.users)
  union all select 'identities belong only to that user', not exists (select 1 from auth.identities i where i.user_id not in (select id from keep)), (select count(*) from auth.identities)::text
  union all select 'two profiles, both SUPER_ADMIN and active', (select count(*) from public.profiles) = 2 and (select count(*) from public.profiles p join keep k on k.id = p.id where p.role = 'SUPER_ADMIN' and p.is_active) = 2, (select string_agg(role::text || '/' || is_active, ', ') from public.profiles)
  union all select 'Super Admins have no workspace membership', not exists (select 1 from public.workspace_members m join keep k on k.id = m.user_id), ''
  union all select 'employee code sequence restarted', (select not is_called and last_value = 1 from public.hr_employee_code_seq), (select last_value::text || ' called=' || is_called from public.hr_employee_code_seq)
  union all select 'no workspaces or memberships', (select count(*) from public.workspaces) + (select count(*) from public.workspace_members) = 0, ''
  union all select 'no clients, projects or tasks', (select count(*) from public.clients) + (select count(*) from public.projects) + (select count(*) from public.tasks) = 0, ''
  union all select 'no task details', (select count(*) from public.task_assignees) + (select count(*) from public.task_comments) + (select count(*) from public.task_attachments) + (select count(*) from public.task_dependencies) + (select count(*) from public.time_entries) = 0, ''
  union all select 'no reports, meetings, notifications, activity, bugs', (select count(*) from public.daily_reports) + (select count(*) from public.meeting_links) + (select count(*) from public.meeting_records) + (select count(*) from public.meeting_participants) + (select count(*) from public.notifications) + (select count(*) from public.activity_logs) + (select count(*) from public.bug_reports) = 0, ''
  union all select 'no client reports', (select count(*) from public.client_reports) + (select count(*) from public.client_report_settings) = 0, ''
  union all select 'no attendance or employee HR records', (select count(*) from public.attendance_sessions) + (select count(*) from public.attendance_breaks) + (select count(*) from public.attendance_audit_log) + (select count(*) from public.hr_leave_applications) + (select count(*) from public.hr_leave_allowances) + (select count(*) from public.hr_employee_profiles) + (select count(*) from public.hr_employee_identity) + (select count(*) from public.hr_public_holidays) = 0, ''
  union all select 'hr_settings kept (1 row)', (select count(*) from public.hr_settings) = 1, (select count(*) from public.hr_settings)::text
  union all select 'hr_leave_policies kept', (select count(*) from public.hr_leave_policies) > 0, (select count(*) from public.hr_leave_policies)::text
  union all select '39 migrations, 001-039', (select array_agg(version order by version) from supabase_migrations.schema_migrations) = (select array_agg(lpad(i::text, 3, '0') order by i) from generate_series(1, 39) i), (select count(*) from supabase_migrations.schema_migrations)::text
  union all select '4 pg_cron jobs', (select count(*) from cron.job) = 4, (select string_agg(jobname, ', ' order by jobname) from cron.job)
  union all select 'RLS enabled on all 31 tables', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and c.relrowsecurity and n.nspname = 'public') = 31, ''
  union all select 'policies (production 039: 120 app + 4 storage)', (select count(*) from pg_policies where schemaname in ('public','private')) = 120 and (select count(*) from pg_policies where schemaname = 'storage') = 4, (select count(*) from pg_policies where schemaname in ('public','private','storage'))::text
  union all select 'app triggers (production 039: 65)', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public','private')) = 65, ''
  union all select 'client-report delete guard enabled', exists (select 1 from pg_trigger where tgname = 'protect_client_report_delete' and tgenabled <> 'D'), ''
  union all select 'hr-photos bucket kept, no files', exists (select 1 from storage.buckets where id = 'hr-photos') and not exists (select 1 from storage.objects), (select count(*) from storage.objects)::text
)
select case when ok then 'PASS' else 'FAIL' end as result, check_name, detail from checks;

rollback;
