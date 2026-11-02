# Starts `next dev` against the LOCAL Supabase stack instead of whatever .env.local points at.
#
# The connection details come from the running local stack (`supabase status`) and are set as
# process environment variables, which take precedence over every .env file in Next.js. The script
# refuses to start unless the local stack is running on its configured API URL, so it can never fall
# back to a hosted project. Keys are never printed.
#
# Usage:  npm run dev:local   (or: powershell -ExecutionPolicy Bypass -File scripts/dev-local.ps1)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

$port = (Select-String -Path "supabase\config.toml" -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -First 1).Matches[0].Groups[1].Value
$expected = "http://127.0.0.1:$port"

$vals = @{}
$ErrorActionPreference = "Continue"   # supabase status writes notices to stderr; only its output matters
npx supabase status -o env 2>$null | ForEach-Object {
  if ("$_" -match '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)="?([^"]*)"?$') { $vals[$Matches[1]] = $Matches[2] }
}
$ErrorActionPreference = "Stop"

if ($vals["API_URL"] -ne $expected -or -not $vals["ANON_KEY"] -or -not $vals["SERVICE_ROLE_KEY"]) {
  Write-Host "REFUSED: the local Supabase stack ($expected) is not running or did not report its keys."
  Write-Host "Start it with: npx supabase start"
  exit 1
}

$env:NEXT_PUBLIC_SUPABASE_URL = $vals["API_URL"]
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $vals["ANON_KEY"]
$env:SUPABASE_SERVICE_ROLE_KEY = $vals["SERVICE_ROLE_KEY"]
Write-Host "next dev -> local Supabase $expected (not a hosted project). Sign in with the accounts in supabase/seed.sql."
npx next dev
