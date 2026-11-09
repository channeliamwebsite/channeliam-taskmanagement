<#
  READ-ONLY verification of production after migrations 037-039.
  One read-only psql session (default_transaction_read_only = on); prints a
  PASS/FAIL table. Expected values = production's verified 036 fingerprint
  (backup prod-036-2026-11-05) plus exactly what 037-039 add, which equals the
  repository migrations 001-039 applied to a clean local database.

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release\verify-production-039.ps1
#>
param(
    [string]$ProjectRef = "ptgtsrbaxczphezegial",
    [string]$PoolerHost = "aws-0-ap-northeast-1.pooler.supabase.com",
    [int]$Port = 5432
)

. (Join-Path $PSScriptRoot "..\backup\_common.ps1")
Assert-PgTools

# Each row: check | expected | actual
$sql = @"
with fp as (
  select 'tables' m, count(*)::text v from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ('public','private')
  union all select 'functions', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')
  union all select 'indexes', count(*)::text from pg_indexes where schemaname in ('public','private')
  union all select 'policies', count(*)::text from pg_policies where schemaname in ('public','private')
  union all select 'storage policies', count(*)::text from pg_policies where schemaname = 'storage'
  union all select 'triggers', count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public','private')
  union all select 'RLS-enabled tables', count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and c.relrowsecurity and n.nspname in ('public','private')
  union all select 'enum types', count(*)::text from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typtype = 'e' and n.nspname in ('public','private')
  union all select 'table grants', count(*)::text from information_schema.role_table_grants where table_schema in ('public','private')
),
expected(m, v) as (values ('tables','31'),('functions','133'),('indexes','113'),('policies','120'),('storage policies','4'),
  ('triggers','65'),('RLS-enabled tables','31'),('enum types','10'),('table grants','497'))
select '1 history: versions 001-039, none missing', 'true',
       ((select array_agg(version order by version) from supabase_migrations.schema_migrations)
        = (select array_agg(lpad(i::text, 3, '0') order by i) from generate_series(1, 39) i))::text
union all
select '9 schema ' || e.m, e.v, coalesce(f.v, 'missing') from expected e left join fp f using (m)
union all select '2 fn project_task_counts', 'true', (to_regprocedure('public.project_task_counts(uuid[])') is not null)::text
union all select '2 fn scheduled_job_health', 'true', (to_regprocedure('public.scheduled_job_health()') is not null)::text
union all select '2 fn retry_scheduled_job', 'true', (to_regprocedure('public.retry_scheduled_job(text)') is not null)::text
union all select '2 tasks read policy has company-admin fast path', 'true',
       coalesce((select qual like '%is_company_admin%' from pg_policies where schemaname = 'public' and tablename = 'tasks' and policyname = 'tasks: read accessible'), false)::text
union all select '3 table client_report_settings (RLS on)', 'true', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.client_report_settings')), false)::text
union all select '3 table client_reports (RLS on)', 'true', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.client_reports')), false)::text
union all select '3 client report policies', '2', (select count(*) from pg_policies where schemaname = 'public' and tablename in ('client_report_settings','client_reports'))::text
union all select '3 client report triggers', '2', (select count(*) from pg_trigger where tgname in ('protect_client_report_snapshot','protect_client_report_delete') and not tgisinternal and tgenabled = 'O')::text
union all select '3 client report indexes', '2', (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('client_reports_client_period_idx','client_reports_failed_idx'))::text
union all select '3 client report functions', '11', (select count(*) from unnest(array[
       'private.can_manage_client_reports(uuid)','private.protect_client_report_snapshot()','private.prevent_client_report_delete()',
       'private.client_report_snapshot(uuid,date,date,smallint)','private.build_client_report(uuid,uuid)','private.generate_client_reports(date,uuid,uuid)',
       'public.save_client_report_settings(uuid,smallint,text,date,boolean,text)','public.set_client_report_delivery(uuid,boolean,boolean)',
       'public.generate_client_reports_now(uuid)','public.retry_client_report(uuid)','public.review_client_report(uuid,text,text,boolean)']) s
       where to_regprocedure(s) is not null)::text
union all select '4 column notifications.dedupe_key', 'true', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'dedupe_key')::text
union all select '4 unique partial index notifications_one_per_dedupe_key', 'true',
       coalesce((select i.indisunique and i.indisvalid and i.indpred is not null from pg_index i where i.indexrelid = to_regclass('public.notifications_one_per_dedupe_key')), false)::text
union all select '4 notification types added', '3', (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'notification_type' and e.enumlabel in ('LEAVE_SUBMITTED','LEAVE_DECIDED','REPORT_REMINDER'))::text
union all select '5 leave triggers on hr_leave_applications (enabled)', '2', (select count(*) from pg_trigger where tgrelid = to_regclass('public.hr_leave_applications') and tgname in ('notify_leave_submitted','notify_leave_decided') and tgenabled = 'O')::text
union all select '6 morning-plan trigger on task_assignees (enabled)', '1', (select count(*) from pg_trigger where tgrelid = to_regclass('public.task_assignees') and tgname = 'add_assigned_task_to_morning_plan' and tgenabled = 'O')::text
union all select '6 fn send_evening_report_reminders', 'true', (to_regprocedure('private.send_evening_report_reminders(timestamptz,boolean)') is not null)::text
union all select '7 cron ' || j.n || ' @ ' || j.s, 'active', coalesce((select case when c.active then 'active' else 'inactive' end || case when c.schedule <> j.s then ' (schedule ' || c.schedule || ')' else '' end from cron.job c where c.jobname = j.n), 'missing')
  from (values ('client-reports','45 0 * * *'),('daily-morning-reports','*/15 * * * *'),('daily-task-reminders','0,30 * * * *'),('evening-report-reminders','0,30 * * * *')) j(n, s)
union all select '7 cron job count', '4', (select count(*) from cron.job)::text
union all select '8 disabled triggers on app tables', '0', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public','private') and t.tgenabled = 'D')::text
union all select '8 invalid indexes', '0', (select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and not i.indisvalid)::text
union all select '8 unvalidated constraints', '0', (select count(*) from pg_constraint k join pg_namespace n on n.oid = k.connamespace where n.nspname in ('public','private') and not k.convalidated)::text
union all select '8 cron failures in last 24h', '0', (select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where d.status = 'failed' and d.start_time > now() - interval '24 hours')::text
order by 1
"@

try {
    $user = "postgres.$ProjectRef"
    Write-Host "READ-ONLY check. Connecting to ${PoolerHost}:$Port as '$user'"
    Set-PgConnection -PgHost $PoolerHost -Port $Port -User $user
    Write-Host "Connection OK (current_user = $(Test-PgConnection))"
    $rows = Invoke-PsqlReadOnly -Sql $sql | Where-Object { $_ -match '\|' }
}
finally { Clear-PgConnection }

$report = foreach ($r in $rows) {
    $check, $expected, $actual = $r -split '\|', 3
    [pscustomobject]@{ Result = $(if ($expected -eq $actual) { "PASS" } else { "FAIL" }); Check = $check; Expected = $expected; Actual = $actual }
}
$report | Format-Table -AutoSize -Wrap
$fails = @($report | Where-Object Result -eq "FAIL")
if ($fails.Count) { Write-Host "RESULT: FAIL ($($fails.Count) of $($report.Count) checks). Nothing was changed." -ForegroundColor Red; exit 1 }
Write-Host "RESULT: PASS ($($report.Count) checks). Nothing was changed." -ForegroundColor Green
