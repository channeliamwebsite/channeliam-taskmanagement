<#
  Applies ONE pending migration (037, 038 or 039) to production, safely.

  Before connecting (offline):
    * the repository file matches the 024-039 archive checksum;
    * the 036 production backup passes verify-production-backup.ps1;
    * -Confirm "APPLY <n> TO ptgtsrbaxczphezegial" is given (unless -RehearseOnly).
  After connecting (hidden password prompt, project-qualified pooler user):
    * read-only preflight: production is exactly at <n-1>, <n> is not recorded,
      the objects <n> creates do not exist yet, pg_cron is installed;
    * the migration file AND its schema_migrations row run in ONE transaction
      (psql --single-transaction, ON_ERROR_STOP, lock_timeout 10 s): any error
      rolls everything back and production stays at <n-1>;
    * -RehearseOnly runs the same transaction and then ROLLS IT BACK;
    * read-only post-checks.
  A full log is written next to the backups (never overwritten).

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release\apply-production-migration.ps1 -Migration 037 -RehearseOnly
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release\apply-production-migration.ps1 -Migration 037 -Confirm "APPLY 037 TO ptgtsrbaxczphezegial"
#>
param(
    [Parameter(Mandatory)][ValidateSet("037", "038", "039")][string]$Migration,
    [string]$Confirm = "",
    [switch]$RehearseOnly,
    [string]$ProjectRef = "ptgtsrbaxczphezegial",
    [string]$PoolerHost = "aws-0-ap-northeast-1.pooler.supabase.com",
    [int]$Port = 5432,
    [string]$ArchiveDir = "$env:USERPROFILE\TaskManagement-Backups\migrations-024-039-2026-11-04",
    [string]$BackupDir = "$env:USERPROFILE\TaskManagement-Backups\prod-036-2026-11-05",
    [string]$LogDir = "$env:USERPROFILE\TaskManagement-Backups\release-037-039"
)

. (Join-Path $PSScriptRoot "..\backup\_common.ps1")
Assert-PgTools

$previous = "{0:D3}" -f ([int]$Migration - 1)
$repoDir = Join-Path $PSScriptRoot "..\..\supabase\migrations"
$files = @(Get-ChildItem $repoDir -Filter "${Migration}_*.sql")
if ($files.Count -ne 1) { throw "Expected exactly one ${Migration}_*.sql in the repository." }
$file = $files[0]
$name = $file.BaseName.Substring(4)

# 1. Checksums: repository = archive manifest = archive copy.
$manifest = @{}
foreach ($line in Get-Content (Join-Path $ArchiveDir "SHA256SUMS.txt")) { if ($line -match '^([0-9A-Fa-f]{64})\s+(.+)$') { $manifest[$Matches[2].Trim()] = $Matches[1].ToUpper() } }
$repoHash = (Get-FileHash $file.FullName -Algorithm SHA256).Hash
$archHash = (Get-FileHash (Join-Path $ArchiveDir $file.Name) -Algorithm SHA256).Hash
if ($repoHash -ne $manifest[$file.Name] -or $repoHash -ne $archHash) { throw "Checksum mismatch for $($file.Name). Stopping." }
Write-Host "Checksum OK: $($file.Name) $($repoHash.Substring(0, 16))..."

# 2. The pre-release backup must verify.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "..\backup\verify-production-backup.ps1") -BackupDir $BackupDir | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Backup $BackupDir does not verify. Stopping." }
Write-Host "Backup verified: $BackupDir"

# 3. Explicit confirmation (before any connection).
$mode = if ($RehearseOnly) { "REHEARSAL (rolled back)" } else { "APPLY" }
if (-not $RehearseOnly -and $Confirm -ne "APPLY $Migration TO $ProjectRef") { throw "Add -Confirm ""APPLY $Migration TO $ProjectRef"" to apply (or use -RehearseOnly)." }

# Objects each migration creates: must be absent before, present after.
$objectsSql = @{
    "037" = "select (to_regprocedure('public.project_task_counts(uuid[])') is not null)::int + (to_regprocedure('public.scheduled_job_health()') is not null)::int + (to_regprocedure('public.retry_scheduled_job(text)') is not null)::int"
    "038" = "select (to_regclass('public.client_report_settings') is not null)::int + (to_regclass('public.client_reports') is not null)::int + (select count(*) from cron.job where jobname = 'client-reports')::int"
    "039" = "select (select count(*) from pg_trigger where tgname in ('notify_leave_submitted', 'notify_leave_decided', 'add_assigned_task_to_morning_plan') and not tgisinternal)::int + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'notifications' and column_name = 'dedupe_key')::int + (select count(*) from cron.job where jobname = 'evening-report-reminders')::int"
}
$objectsAfter = @{ "037" = 3; "038" = 3; "039" = 5 }

New-Item -ItemType Directory -Force $LogDir | Out-Null
$log = Join-Path $LogDir ("{0}-{1}-{2}.log" -f $Migration, $(if ($RehearseOnly) { "rehearsal" } else { "apply" }), (Get-Date -Format "yyyyMMdd-HHmmss"))
if (Test-Path $log) { throw "Log $log exists; refusing to overwrite." }

try {
    $user = "postgres.$ProjectRef"
    Write-Host "Mode: $mode. Connecting to ${PoolerHost}:$Port as '$user'"
    Set-PgConnection -PgHost $PoolerHost -Port $Port -User $user
    Write-Host "Connection OK (current_user = $(Test-PgConnection))"

    # 4. Read-only preflight.
    $state = (Invoke-PsqlReadOnly -Sql "select (select max(version) from supabase_migrations.schema_migrations) || '|' || (select count(*) from supabase_migrations.schema_migrations where version = '$Migration') || '|' || (select count(*) from pg_extension where extname = 'pg_cron') || '|' || (select count(*) from cron.job)" | Select-Object -Last 1) -split '\|'
    $level, $recorded, $hasCron, $jobsBefore = $state
    Write-Host "Production at $level; $Migration recorded: $recorded; pg_cron: $hasCron; cron jobs: $jobsBefore"
    if ($level -ne $previous) { throw "Production is at $level, expected $previous. Nothing changed." }
    if ($recorded -ne "0") { throw "$Migration is already recorded. Nothing changed." }
    if ($hasCron -ne "1") { throw "pg_cron is not installed; 038/039 would not schedule their jobs. Nothing changed." }
    $objectsBefore = [int](Invoke-PsqlReadOnly -Sql $objectsSql[$Migration] | Select-Object -Last 1)
    Write-Host "$Migration objects already present: $objectsBefore (must be 0)"
    if ($objectsBefore -ne 0) { throw "Some $Migration objects already exist ($objectsBefore). Investigate before applying. Nothing changed." }

    # 5. Migration + history row in ONE transaction.
    $psqlArgs = @("-X", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-L", $log,
                  "-c", "set lock_timeout = '10s'", "-c", "set statement_timeout = '5min'",
                  "-f", $file.FullName,
                  "-c", "insert into supabase_migrations.schema_migrations (version, name) values ('$Migration', '$name')")
    if ($RehearseOnly) { $psqlArgs += @("-c", "rollback") }
    Write-Host "Running $($file.Name) ($mode)..."
    $ErrorActionPreference = "Continue"
    & psql @psqlArgs 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match 'ERROR|FATAL|WARNING: +there is no transaction' -or $_ -match '^psql:.*error' } | ForEach-Object { Write-Host $_ }
    $exit = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($exit -ne 0) { throw "Migration $Migration FAILED and was rolled back (production still at $previous). Log: $log" }

    # 6. Read-only post-checks.
    $levelAfter = Invoke-PsqlReadOnly -Sql "select max(version) from supabase_migrations.schema_migrations" | Select-Object -Last 1
    $objectsNow = [int](Invoke-PsqlReadOnly -Sql $objectsSql[$Migration] | Select-Object -Last 1)
    $jobs = Invoke-PsqlReadOnly -Sql "select string_agg(jobname, ', ' order by jobname) from cron.job" | Select-Object -Last 1
    Write-Host "After: level $levelAfter; $Migration objects present $objectsNow; cron jobs: $jobs"
    if ($RehearseOnly) {
        if ($levelAfter -ne $previous -or $objectsNow -ne 0) { throw "Rehearsal left changes behind (level $levelAfter, objects $objectsNow). Investigate now." }
        Write-Host "`nREHEARSAL PASSED: $Migration runs cleanly and was rolled back. Production unchanged at $previous." -ForegroundColor Green
    } else {
        if ($levelAfter -ne $Migration -or $objectsNow -ne $objectsAfter[$Migration]) { throw "Post-check failed (level $levelAfter, objects $objectsNow of $($objectsAfter[$Migration])). Investigate before continuing." }
        Write-Host "`nAPPLIED: production is now at $Migration. Log: $log" -ForegroundColor Green
    }
}
finally {
    Clear-PgConnection
}
