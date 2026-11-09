<#
  Runs the app locally against the STAGING Supabase project (no Docker needed).

  Reads settings from .env.staging (git-ignored; you create it, never commit it):
    NEXT_PUBLIC_SUPABASE_URL=https://zjldhnfsjdnpeolqxqmc.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon / publishable key>
    SUPABASE_SERVICE_ROLE_KEY=<staging service role key>   (optional: employee admin actions)
    HR_ENCRYPTION_KEY=<staging-only key>                    (optional: PAN features)
    HR_ENCRYPTION_KEY_VERSION=1                             (optional)

  Safety:
    * Refuses to run unless the URL is the staging project, and refuses any
      production reference.
    * Every variable defined in the other .env files but missing from
      .env.staging is set to a placeholder for this process, so Next.js can
      never fall back to the production values in .env.local.
    * Prints variable NAMES only, never values.

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\run-staging-local.ps1
#>
param([int]$Port = 3001, [switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$StagingRef = "zjldhnfsjdnpeolqxqmc"
$ProductionRef = "ptgtsrbaxczphezegial"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Read-EnvFile([string]$path) {
  $map = [ordered]@{}
  if (-not (Test-Path $path)) { return $map }
  foreach ($line in Get-Content $path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
      $map[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
  }
  return $map
}

$staging = Read-EnvFile (Join-Path $root ".env.staging")
if ($staging.Count -eq 0) { throw "Create .env.staging first (see the comment at the top of this script)." }
$url = [string]$staging["NEXT_PUBLIC_SUPABASE_URL"]
if ($url -notmatch [regex]::Escape($StagingRef)) { throw "REFUSED: NEXT_PUBLIC_SUPABASE_URL in .env.staging is not the staging project ($StagingRef)." }
foreach ($v in $staging.Values) { if ("$v" -match $ProductionRef) { throw "REFUSED: .env.staging contains a production reference." } }
if (-not $staging["NEXT_PUBLIC_SUPABASE_ANON_KEY"]) { throw "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing in .env.staging." }
if (-not $staging["APP_URL"]) { $staging["APP_URL"] = "http://localhost:$Port" }

# Block fallback to any other .env file's values.
$blocked = @()
foreach ($f in ".env", ".env.local", ".env.production", ".env.production.local", ".env.development.local") {
  foreach ($k in (Read-EnvFile (Join-Path $root $f)).Keys) {
    if (-not $staging.Contains($k) -and $blocked -notcontains $k) { $blocked += $k }
  }
}
foreach ($k in $staging.Keys) { Set-Item "Env:$k" $staging[$k] }
# An empty value would DELETE the variable on Windows (and let Next.js fall
# back to .env.local), so blocked keys get a placeholder that no service accepts.
foreach ($k in $blocked) { Set-Item "Env:$k" "blocked-for-staging-run" }

Write-Host "Staging run: Supabase project $StagingRef, port $Port"
Write-Host "Set from .env.staging: $($staging.Keys -join ', ')"
if ($blocked.Count) { Write-Host "Blanked (not in .env.staging): $($blocked -join ', ')" }

if (-not $SkipBuild) {
  & npx next build
  if ($LASTEXITCODE -ne 0) { throw "Build failed." }
}
& npx next start --port $Port
