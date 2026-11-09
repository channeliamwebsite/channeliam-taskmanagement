<#
  Read-only backup of the production TaskManagement database (migration 036).

  * Connects through the Supabase Session Pooler as postgres.<project ref>.
  * The password is asked with a hidden prompt; it is never written to disk,
    to the backup folder, to command history or to a connection string.
  * Never overwrites: refuses to run unless the backup folder is empty.
  * Only reads: pg_dump / pg_dumpall, and psql sessions that first run
    "set default_transaction_read_only = on".

  Usage (from the repository root, in your own PowerShell window):
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\backup-production.ps1
#>
param(
    [string]$BackupDir = "$env:USERPROFILE\TaskManagement-Backups\prod-036-2026-11-05",
    [string]$ProjectRef = "ptgtsrbaxczphezegial",
    [string]$PoolerHost = "aws-0-ap-northeast-1.pooler.supabase.com",
    [int]$Port = 5432,
    [string]$ExpectedMigration = "036",
    # Testing only (local rehearsal): override the user / SSL mode, and read the
    # password from TM_LOCAL_PGPASSWORD instead of the hidden prompt.
    [string]$User = "",
    [string]$SslMode = "require",
    [switch]$LocalRehearsal
)
if ($LocalRehearsal -and $PoolerHost -notin "127.0.0.1", "localhost") { throw "-LocalRehearsal is only allowed against 127.0.0.1." }
if (-not $User) { $User = "postgres.$ProjectRef" }

. (Join-Path $PSScriptRoot "_common.ps1")

if (-not (Test-Path $BackupDir)) { throw "Backup folder not found: $BackupDir" }
if (@(Get-ChildItem -Force $BackupDir).Count -gt 0) { throw "Backup folder is not empty. Refusing to overwrite. Use a new folder: $BackupDir" }
Assert-PgTools

$status = [ordered]@{}
function Step($name, [scriptblock]$body) {
    Write-Host "-> $name"
    try { & $body; $script:status[$name] = "OK" }
    catch { $script:status[$name] = "FAILED: $($_.Exception.Message -replace 'password[^\s]*', 'password ***')"; Write-Warning "$name failed: $($script:status[$name])" }
}

$f = @{
    roles = Join-Path $BackupDir "01-roles.sql"; schema = Join-Path $BackupDir "02-schema.sql"
    extra = Join-Path $BackupDir "03-auth-storage-objects.sql"; data = Join-Path $BackupDir "04-data.sql"
    migr = Join-Path $BackupDir "05-migration-history.csv"; cron = Join-Path $BackupDir "06-cron-jobs.csv"
    rows = Join-Path $BackupDir "07-row-counts.csv"; fp = Join-Path $BackupDir "08-fingerprint.csv"
    buckets = Join-Path $BackupDir "09-storage-buckets.csv"; objects = Join-Path $BackupDir "10-storage-objects.csv"
    ext = Join-Path $BackupDir "11-extensions.csv"
}

try {
    Write-Host "Connecting to ${PoolerHost}:$Port as user '$User' (database postgres, sslmode $SslMode)"
    Set-PgConnection -PgHost $PoolerHost -Port $Port -User $User -SslMode $SslMode -PasswordFromEnv:$LocalRehearsal
    $connectedAs = Test-PgConnection
    Write-Host "Connection OK (server reports current_user = $connectedAs)"

    # Preflight: who/where we are and the migration level. Stops on failure.
    $pre = Invoke-PsqlReadOnly -Sql "select current_user || '|' || current_setting('server_version') || '|' || (select max(version) from supabase_migrations.schema_migrations) || '|' || (select count(*) from supabase_migrations.schema_migrations)"
    $user, $serverVersion, $maxMigration, $migrationCount = (($pre | Select-Object -Last 1) -split '\|')
    Write-Host "Connected as $user; server $serverVersion; migrations $migrationCount, latest $maxMigration"
    if ($maxMigration -ne $ExpectedMigration) { throw "Production is at $maxMigration, expected $ExpectedMigration. Stopping." }
    if ($serverVersion -notmatch '^17\.') { throw "Server is PostgreSQL $serverVersion; this tooling expects 17." }

    Step "roles" { & pg_dumpall --roles-only --no-role-passwords -f $f.roles; if ($LASTEXITCODE) { throw "pg_dumpall exit $LASTEXITCODE" } }
    Step "schema" { & pg_dump --schema-only --quote-all-identifiers -n public -n private -n supabase_migrations -f $f.schema; if ($LASTEXITCODE) { throw "pg_dump exit $LASTEXITCODE" } }
    Step "auth-storage-objects" { Invoke-PsqlReadOnly -Sql $Q_EXTRA_OBJECTS -OutFile $f.extra -Raw | Out-Null }
    Step "data" {
        # -t patterns only: when any -t is given, pg_dump ignores -n.
        & pg_dump --data-only --quote-all-identifiers -t "public.*" -t "private.*" -t "supabase_migrations.*" `
            -t auth.users -t auth.identities -t auth.mfa_factors -t storage.buckets -t storage.objects -f $f.data
        if ($LASTEXITCODE) { throw "pg_dump exit $LASTEXITCODE" }
    }
    Step "migration-history" { Invoke-PsqlReadOnly -Csv -OutFile $f.migr -Sql "select version, name from supabase_migrations.schema_migrations order by version" | Out-Null }
    Step "cron-jobs" { Invoke-PsqlReadOnly -Csv -OutFile $f.cron -Sql "select jobid, jobname, schedule, command, database, username, active from cron.job order by jobname" | Out-Null }
    Step "row-counts" { Invoke-PsqlReadOnly -Csv -OutFile $f.rows -Sql $Q_ROW_COUNTS | Out-Null }
    Step "fingerprint" { Invoke-PsqlReadOnly -Csv -OutFile $f.fp -Sql $Q_FINGERPRINT | Out-Null }
    Step "storage-buckets" { Invoke-PsqlReadOnly -Csv -OutFile $f.buckets -Sql "select b.id, b.public, b.file_size_limit, b.allowed_mime_types::text as allowed_mime_types, count(o.id) as objects, coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by 1, 2, 3, 4 order by 1" | Out-Null }
    Step "storage-objects" { Invoke-PsqlReadOnly -Csv -OutFile $f.objects -Sql "select bucket_id, name, (metadata->>'size')::bigint as bytes, created_at from storage.objects order by bucket_id, name" | Out-Null }
    Step "extensions" { Invoke-PsqlReadOnly -Csv -OutFile $f.ext -Sql "select extname, extversion, extnamespace::regnamespace::text as schema from pg_extension order by 1" | Out-Null }
}
finally {
    Clear-PgConnection
}

# Manifest (no secrets) and checksums.
$manifest = [ordered]@{
    created_utc = (Get-Date).ToUniversalTime().ToString("o"); project_ref = $ProjectRef; pooler_host = $PoolerHost
    server_version = $serverVersion; migration_latest = $maxMigration; migration_count = $migrationCount
    pg_dump = (& pg_dump --version); steps = $status
    not_included = @("Storage object FILES (download separately if 10-storage-objects.csv lists any)", "Auth sessions and refresh tokens (deliberately excluded)", "Supabase project settings, Auth URL config, email templates, SMTP", "Vercel environment variables", "HR_ENCRYPTION_KEY (kept separately by the owner)")
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $BackupDir "00-manifest.json")

$sums = Get-ChildItem $BackupDir -File | Where-Object Name -ne "SHA256SUMS.txt" | Sort-Object Name |
    ForEach-Object { "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Name }
$sums | Set-Content -Encoding ascii (Join-Path $BackupDir "SHA256SUMS.txt")

Write-Host ""
$status.GetEnumerator() | ForEach-Object { "{0,-22} {1}" -f $_.Key, $_.Value } | Write-Host
$failed = @($status.Values | Where-Object { $_ -ne "OK" })
if ($failed.Count) { Write-Host "`nBACKUP INCOMPLETE: $($failed.Count) step(s) failed. Do not rely on this backup." -ForegroundColor Red; exit 1 }
Write-Host "`nBackup files written. Now run verify-production-backup.ps1 (offline) before relying on it." -ForegroundColor Green
