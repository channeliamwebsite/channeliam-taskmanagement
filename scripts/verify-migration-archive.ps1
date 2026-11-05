param(
    [string]$BackupDirectory = "C:\Users\Hima Girish\TaskManagement-Backups\migrations-024-039-2026-11-04"
)

$ErrorActionPreference = "Stop"

$RepoDirectory = Join-Path $PSScriptRoot "..\supabase\migrations"
$ManifestPath = Join-Path $BackupDirectory "SHA256SUMS.txt"

$ExpectedFiles = @(
    "024_attendance_core.sql",
    "025_company_admin_authorization.sql",
    "026_company_audit_events.sql",
    "027_archive_not_delete.sql",
    "028_individual_clients_projects.sql",
    "029_meeting_participants.sql",
    "030_project_collaborators.sql",
    "031_protect_meeting_records.sql",
    "032_inactive_accounts_no_access.sql",
    "033_attendance_breaks_and_policy.sql",
    "034_hr_leave_and_holidays.sql",
    "035_hr_employee_profiles.sql",
    "036_hr_monthly_cl_credits.sql",
    "037_progress_counts_and_job_health.sql",
    "038_client_reports.sql",
    "039_daily_workflow_notifications.sql"
)

if (-not (Test-Path $BackupDirectory)) {
    throw "Backup directory not found: $BackupDirectory"
}

if (-not (Test-Path $RepoDirectory)) {
    throw "Repository migrations directory not found: $RepoDirectory"
}

if (-not (Test-Path $ManifestPath)) {
    throw "SHA256 manifest not found: $ManifestPath"
}

$ManifestEntries = @{}

foreach ($line in Get-Content $ManifestPath) {
    if ($line -match '^([A-Fa-f0-9]{64})\s+(.+)$') {
        $hash = $Matches[1].ToUpper()
        $name = $Matches[2].Trim()

        if ($ManifestEntries.ContainsKey($name)) {
            throw "Duplicate manifest entry: $name"
        }

        $ManifestEntries[$name] = $hash
    }
    elseif (-not [string]::IsNullOrWhiteSpace($line)) {
        throw "Invalid manifest line: $line"
    }
}

$Unexpected = @($ManifestEntries.Keys | Where-Object { $_ -notin $ExpectedFiles })
$Missing = @($ExpectedFiles | Where-Object { -not $ManifestEntries.ContainsKey($_) })

if ($Unexpected.Count -gt 0) {
    throw "Unexpected manifest entries: $($Unexpected -join ', ')"
}

if ($Missing.Count -gt 0) {
    throw "Missing manifest entries: $($Missing -join ', ')"
}

$Results = foreach ($name in $ExpectedFiles) {
    $backupFile = Join-Path $BackupDirectory $name
    $repoFile = Join-Path $RepoDirectory $name

    if (-not (Test-Path $backupFile)) {
        throw "Backup migration missing: $name"
    }

    if (-not (Test-Path $repoFile)) {
        throw "Repository migration missing: $name"
    }

    $backupHash = (Get-FileHash $backupFile -Algorithm SHA256).Hash
    $repoHash = (Get-FileHash $repoFile -Algorithm SHA256).Hash
    $manifestHash = $ManifestEntries[$name]

    [PSCustomObject]@{
        Migration = $name
        ManifestMatch = ($backupHash -eq $manifestHash)
        RepositoryMatch = ($backupHash -eq $repoHash)
    }
}

$Results | Format-Table -AutoSize

$ManifestFailures = @($Results | Where-Object { -not $_.ManifestMatch })
$RepositoryFailures = @($Results | Where-Object { -not $_.RepositoryMatch })

Write-Host ""
Write-Host "Migrations checked: $($Results.Count)"
Write-Host "Manifest mismatches: $($ManifestFailures.Count)"
Write-Host "Repository mismatches: $($RepositoryFailures.Count)"

if ($ManifestFailures.Count -gt 0 -or $RepositoryFailures.Count -gt 0) {
    throw "VERIFICATION FAILED. Do not proceed with release preparation."
}

Write-Host ""
Write-Host "SUCCESS: All $($Results.Count) migrations passed archive verification." -ForegroundColor Green
Write-Host "This script performed read-only file checks. No database was accessed."
