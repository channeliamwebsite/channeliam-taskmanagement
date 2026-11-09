<#
  Offline verification of a backup folder written by backup-production.ps1.
  Does not connect to any database. Read-only file checks.

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\verify-production-backup.ps1
#>
param(
    [string]$BackupDir = "$env:USERPROFILE\TaskManagement-Backups\prod-036-2026-11-05",
    [string]$ExpectedMigration = "036"
)

$ErrorActionPreference = "Stop"
$results = New-Object System.Collections.Generic.List[object]
function Check($name, [bool]$pass, $detail = "") { $results.Add([pscustomobject]@{ Check = $name; Result = $(if ($pass) { "PASS" } else { "FAIL" }); Detail = $detail }) }
function P($n) { Join-Path $BackupDir $n }

if (-not (Test-Path $BackupDir)) { Write-Host "NO BACKUP FOUND: folder does not exist: $BackupDir" -ForegroundColor Yellow; exit 2 }
if (@(Get-ChildItem -Force $BackupDir).Count -eq 0) { Write-Host "NO BACKUP FOUND: the folder is empty (no backup has been taken). Not verified." -ForegroundColor Yellow; exit 2 }
if (-not (Test-Path (Join-Path $BackupDir "00-manifest.json"))) { Write-Host "INCOMPLETE BACKUP: files exist but the manifest is missing (the backup did not finish). Not verified; take a new backup into a new folder." -ForegroundColor Red; exit 1 }
$required ="00-manifest.json", "01-roles.sql", "02-schema.sql", "03-auth-storage-objects.sql", "04-data.sql", "05-migration-history.csv",
            "06-cron-jobs.csv", "07-row-counts.csv", "08-fingerprint.csv", "09-storage-buckets.csv", "10-storage-objects.csv", "11-extensions.csv", "SHA256SUMS.txt"
foreach ($n in $required) { $ok = (Test-Path (P $n)) -and ((Get-Item (P $n)).Length -gt 0 -or $n -eq "03-auth-storage-objects.sql"); Check "present: $n" $ok }
if ($results | Where-Object Result -eq "FAIL") { $results | Format-Table -AutoSize; throw "Missing files; backup not usable." }

# Checksums.
$listed = @{}
foreach ($line in Get-Content (P "SHA256SUMS.txt")) { if ($line -match '^([0-9A-Fa-f]{64})\s+(.+)$') { $listed[$Matches[2]] = $Matches[1].ToUpper() } }
foreach ($file in Get-ChildItem $BackupDir -File | Where-Object Name -ne "SHA256SUMS.txt") {
    Check "sha256: $($file.Name)" ($listed[$file.Name] -eq (Get-FileHash $file.FullName -Algorithm SHA256).Hash) $(if (-not $listed.ContainsKey($file.Name)) { "not listed" })
}

# Manifest steps.
$manifest = Get-Content (P "00-manifest.json") -Raw | ConvertFrom-Json
foreach ($s in $manifest.steps.PSObject.Properties) { Check "backup step: $($s.Name)" ($s.Value -eq "OK") $s.Value }

# Dumps finished.
foreach ($n in "02-schema.sql", "04-data.sql") { Check "complete dump: $n" ([bool](Select-String -Path (P $n) -SimpleMatch "PostgreSQL database dump complete" -Quiet)) }
Check "roles dump has no passwords" (-not (Select-String -Path (P "01-roles.sql") -Pattern "PASSWORD '" -Quiet))

# Migration history 001..expected, contiguous.
$versions = @(Import-Csv (P "05-migration-history.csv") | ForEach-Object version)
$expected = 1..([int]$ExpectedMigration) | ForEach-Object { "{0:D3}" -f $_ }
Check "migration history 001-$ExpectedMigration" ($null -eq (Compare-Object $versions $expected -SyncWindow 0)) "found $($versions.Count), latest $(if ($versions.Count) { $versions[-1] } else { 'none' })"

# Schema object counts vs live fingerprint.
$fp = @{}; Import-Csv (P "08-fingerprint.csv") | ForEach-Object { $fp[$_.metric] = [int]$_.value }
$schema = Get-Content (P "02-schema.sql") -Raw
$dumpPolicies = ([regex]::Matches($schema, '(?m)^CREATE POLICY ')).Count
$dumpTriggers = ([regex]::Matches($schema, '(?m)^CREATE (OR REPLACE )?(CONSTRAINT )?TRIGGER ')).Count
$dumpRls = ([regex]::Matches($schema, 'ENABLE ROW LEVEL SECURITY')).Count
Check "policies in dump = live" ($dumpPolicies -eq $fp["policies_app"]) "dump $dumpPolicies / live $($fp['policies_app'])"
Check "triggers in dump = live" ($dumpTriggers -eq $fp["triggers_app"]) "dump $dumpTriggers / live $($fp['triggers_app'])"
Check "RLS-enabled tables = live" ($dumpRls -eq $fp["rls_enabled_tables"]) "dump $dumpRls / live $($fp['rls_enabled_tables'])"
Check "grants present in schema" ([regex]::Matches($schema, '(?m)^GRANT ').Count -gt 0)
$extra = @(Get-Content (P "03-auth-storage-objects.sql") | Where-Object { $_ -match '^(CREATE (CONSTRAINT )?TRIGGER|create policy) ' })
Check "auth/storage triggers+policies captured" ($extra.Count -eq ($fp["triggers_auth_storage_app"] + $fp["policies_storage"])) "file $($extra.Count) / live $($fp['triggers_auth_storage_app'] + $fp['policies_storage'])"

# Data rows per table in the COPY blocks vs live row counts (streamed; no data printed).
$copyRows = @{}; $current = $null
foreach ($line in [System.IO.File]::ReadLines((P "04-data.sql"))) {
    if ($null -eq $current) {
        if ($line -match '^COPY "([^"]+)"\."([^"]+)"') { $current = "$($Matches[1]).$($Matches[2])"; $copyRows[$current] = 0 }
    } elseif ($line -eq '\.') { $current = $null } else { $copyRows[$current]++ }
}
$liveRows = @{}; Import-Csv (P "07-row-counts.csv") | ForEach-Object { $liveRows["$($_.schema_name).$($_.table_name)"] = [int64]$_.row_count }
foreach ($k in $liveRows.Keys | Sort-Object) {
    $d = if ($copyRows.ContainsKey($k)) { $copyRows[$k] } else { 0 }
    Check "rows: $k" ($d -eq $liveRows[$k]) "dump $d / live $($liveRows[$k])"
}
foreach ($k in "auth.users", "auth.identities", "public.profiles", "supabase_migrations.schema_migrations") { Check "data includes $k" ($copyRows.ContainsKey($k) -and $copyRows[$k] -gt 0) }

# No secrets or connection strings in the folder.
$leak = Select-String -Path (Join-Path $BackupDir "*") -Pattern "postgres(ql)?://[^\s]*:[^\s]*@", "HR_ENCRYPTION_KEY\s*=", "PGPASSWORD", "sb_secret_" -List
Check "no credentials in backup folder" (-not $leak) (($leak | ForEach-Object Filename) -join ", ")

$results | Format-Table -AutoSize
$cron = @(Import-Csv (P "06-cron-jobs.csv")); $objects = @(Import-Csv (P "10-storage-objects.csv"))
Write-Host "pg_cron jobs captured: $($cron.Count) ($(($cron | ForEach-Object jobname) -join ', '))"
Write-Host "Storage objects listed: $($objects.Count)"
$fails = @($results | Where-Object Result -eq "FAIL")
if ($fails.Count) { Write-Host "`nVERIFICATION FAILED: $($fails.Count) check(s). Backup is NOT verified." -ForegroundColor Red; exit 1 }
if ($objects.Count) { Write-Host "`nDATABASE BACKUP VERIFIED. NEEDS MANUAL ACTION: download the $($objects.Count) storage file(s) listed in 10-storage-objects.csv." -ForegroundColor Yellow; exit 0 }
Write-Host "`nDATABASE BACKUP VERIFIED (no storage files to download). Next: restore test." -ForegroundColor Green
