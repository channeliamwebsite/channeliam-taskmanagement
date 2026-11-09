<#
  Restore test: loads a verified backup into a DISPOSABLE LOCAL Supabase stack
  and compares it with the production counts captured at backup time.

  * Refuses any host other than 127.0.0.1 / localhost, refuses the project's
    own dev stack port (55622), and needs -Confirm "RESTORE TO DISPOSABLE".
  * Never use this against staging or production. Production data stays on
    this machine; the disposable stack is deleted afterwards.
  * Writes nothing to the backup folder (results go to -WorkDir).

  See scripts\backup\README.md for creating the disposable stack first.
#>
param(
    [string]$BackupDir = "$env:USERPROFILE\TaskManagement-Backups\prod-036-2026-11-05",
    [string]$WorkDir = "C:\tm-restore\results",
    [string]$TargetHost = "127.0.0.1",
    [int]$TargetPort = 55822,
    [string]$Confirm = "",
    [string]$ExpectedMigration = "036",
    [switch]$SkipPanCheck
)

. (Join-Path $PSScriptRoot "_common.ps1")

if ($TargetHost -notin "127.0.0.1", "localhost") { throw "Restore target must be a local disposable stack (127.0.0.1)." }
if ($TargetPort -eq 55622) { throw "Port 55622 is the project's own dev stack. Use the disposable stack (default 55822)." }
if ($Confirm -ne "RESTORE TO DISPOSABLE") { throw 'Add -Confirm "RESTORE TO DISPOSABLE" to run.' }
Assert-PgTools

# 1. The backup must verify first.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-production-backup.ps1") -BackupDir $BackupDir -ExpectedMigration $ExpectedMigration | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Backup verification failed; not restoring." }
New-Item -ItemType Directory -Force $WorkDir | Out-Null

function P($n) { Join-Path $BackupDir $n }
# Local Supabase CLI stacks use the well-known local password "postgres".
$env:TM_LOCAL_PGPASSWORD = "postgres"
Set-PgConnection -PgHost $TargetHost -Port $TargetPort -User "postgres" -SslMode "disable" -PasswordFromEnv
Remove-Item Env:TM_LOCAL_PGPASSWORD

try {
    # 2. Sanity: the target must be empty of app data (fresh stack, no migrations).
    $existing = Invoke-PsqlReadOnly -Sql "select count(*) from information_schema.tables where table_schema = 'public'"
    if ([int]($existing | Select-Object -Last 1) -gt 0) { throw "Target already has public tables. Use a fresh disposable stack (empty workdir, no migrations)." }

    # 3. Prepare: extensions the app uses, and empty app schemas recreated by the dump.
    $prep = Join-Path $WorkDir "00-prepare.sql"
    @(
        "create extension if not exists btree_gist with schema extensions;",
        "create extension if not exists pg_cron with schema pg_catalog;",
        "drop schema if exists private cascade;",
        "drop schema if exists supabase_migrations cascade;",
        # Fresh Supabase targets auto-grant on new tables/functions; clear that so
        # restored objects get exactly the dumped ACLs (the dump re-adds the
        # default privileges at its end).
        "alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role, postgres;",
        "alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role, postgres;",
        "alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role, postgres;"
    ) | Set-Content -Encoding ascii $prep

    # Schema copy for restore: a fresh Supabase target already has the public
    # schema and the platform's own default privileges (only supabase_admin may
    # set those), so skip them. The backup file itself is never changed.
    $schemaRestore = Join-Path $WorkDir "02-schema-restore.sql"
    $schemaLines = foreach ($line in [IO.File]::ReadLines((P "02-schema.sql"))) {
        if ($line -like 'ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"*') { continue }
        $line -replace '^CREATE SCHEMA "(\w+)";$', 'CREATE SCHEMA IF NOT EXISTS "$1";'
    }
    [IO.File]::WriteAllLines($schemaRestore, [string[]]$schemaLines)

    # Only roles that are not Supabase-managed (normally none).
    $reserved = '^(postgres|anon|authenticated|authenticator|service_role|dashboard_user|pgbouncer|pgsodium_\w+|supabase_\w+|pg_\w+|cli_login_postgres|realtime_\w+)$'
    $roles = Join-Path $WorkDir "01-roles-filtered.sql"
    $custom = @(Get-Content (P "01-roles.sql") | Where-Object { $_ -match '^(CREATE|ALTER) ROLE "?([^" ;]+)"?' -and $Matches[2] -notmatch $reserved })
    (@("-- Non-Supabase roles from 01-roles.sql ($($custom.Count) statement(s))") + $custom) | Set-Content -Encoding UTF8 $roles

    # 4. Restore in one transaction; triggers off while loading data.
    $restoreLog = Join-Path $WorkDir "restore.log"
    & psql -X -v ON_ERROR_STOP=1 --single-transaction `
        -f $prep -f $roles -f $schemaRestore -f (P "03-auth-storage-objects.sql") `
        -c "set session_replication_role = replica" -f (P "04-data.sql") -L $restoreLog -q
    if ($LASTEXITCODE -ne 0) { throw "Restore failed (transaction rolled back). See $restoreLog" }

    # 5. Re-create pg_cron jobs from the captured definitions.
    $cronSql = Join-Path $WorkDir "05-cron.sql"
    Import-Csv (P "06-cron-jobs.csv") | ForEach-Object {
        $q = { param($s) "'" + ($s -replace "'", "''") + "'" }
        "select cron.schedule($(& $q $_.jobname), $(& $q $_.schedule), $(& $q $_.command));"
    } | Set-Content -Encoding UTF8 $cronSql
    & psql -X -q -v ON_ERROR_STOP=1 -f $cronSql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Re-creating pg_cron jobs failed." }

    # 6. Capture the same counts from the restored copy and compare.
    $rows = Join-Path $WorkDir "07-row-counts.csv"; $fp = Join-Path $WorkDir "08-fingerprint.csv"; $migr = Join-Path $WorkDir "05-migration-history.csv"
    Invoke-PsqlReadOnly -Csv -OutFile $rows -Sql $Q_ROW_COUNTS | Out-Null
    Invoke-PsqlReadOnly -Csv -OutFile $fp -Sql $Q_FINGERPRINT | Out-Null
    Invoke-PsqlReadOnly -Csv -OutFile $migr -Sql "select version, name from supabase_migrations.schema_migrations order by version" | Out-Null

    $report = New-Object System.Collections.Generic.List[object]
    function Cmp($what, $a, $b) { $report.Add([pscustomobject]@{ Check = $what; Production = $a; Restored = $b; Result = $(if ("$a" -eq "$b") { "PASS" } else { "FAIL" }) }) }
    $pr = Import-CsvMap (P "07-row-counts.csv") schema_name, table_name row_count; $rr = Import-CsvMap $rows schema_name, table_name row_count
    foreach ($k in $pr.Keys | Sort-Object) { Cmp "rows $k" $pr[$k] $rr[$k] }
    $pf = Import-CsvMap (P "08-fingerprint.csv") metric value; $rf = Import-CsvMap $fp metric value
    foreach ($k in $pf.Keys | Sort-Object) { Cmp "schema $k" $pf[$k] $rf[$k] }
    Cmp "migration history" ((Import-Csv (P "05-migration-history.csv")).version -join ",") ((Import-Csv $migr).version -join ",")
    $jobs = Invoke-PsqlReadOnly -Sql "select string_agg(jobname, ',' order by jobname) from cron.job"
    Cmp "pg_cron jobs" (((Import-Csv (P "06-cron-jobs.csv")).jobname | Sort-Object) -join ",") ($jobs | Select-Object -Last 1)

    # 7. PAN decryption with the separately kept key (prints counts only).
    if (-not $SkipPanCheck) {
        $panFile = Join-Path $WorkDir "pan-ciphertexts.tmp"
        Invoke-PsqlReadOnly -Raw -OutFile $panFile -Sql "select user_id::text || '|' || pan_ciphertext from public.hr_employee_identity where pan_ciphertext is not null" | Out-Null
        $total = @(Get-Content $panFile | Where-Object { $_ }).Count
        if ($total -eq 0) { Cmp "PAN decryption" "no PAN stored" "no PAN stored" }
        else {
            $secure = Read-Host "HR_ENCRYPTION_KEY (hidden; used in memory only)" -AsSecureString
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            try { $env:HR_ENCRYPTION_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
            $env:HR_ENCRYPTION_KEY_VERSION = Read-Host "HR_ENCRYPTION_KEY_VERSION (Enter for 1)"
            if (-not $env:HR_ENCRYPTION_KEY_VERSION) { $env:HR_ENCRYPTION_KEY_VERSION = "1" }
            try { $ok = (& node (Join-Path $PSScriptRoot "pan-decrypt-check.mjs") $panFile | Select-Object -Last 1) }
            finally { Remove-Item Env:HR_ENCRYPTION_KEY, Env:HR_ENCRYPTION_KEY_VERSION -ErrorAction SilentlyContinue }
            Cmp "PAN decryption (rows decrypted)" $total $ok
        }
        Remove-Item $panFile -ErrorAction SilentlyContinue
    }

    $report | Format-Table -AutoSize
    $report | Export-Csv -NoTypeInformation (Join-Path $WorkDir "restore-report.csv")
    $objects = @(Import-Csv (P "10-storage-objects.csv")).Count
    if ($objects) { Write-Host "Storage: $objects object row(s) restored as metadata only; files must be re-uploaded from the separate download." -ForegroundColor Yellow }
    $fails = @($report | Where-Object Result -eq "FAIL").Count
    if ($fails) { Write-Host "`nRESTORE TEST FAILED: $fails check(s)." -ForegroundColor Red; exit 1 }
    Write-Host "`nRESTORE TEST PASSED. Delete the disposable stack when done (see README)." -ForegroundColor Green
}
finally {
    Clear-PgConnection
}
