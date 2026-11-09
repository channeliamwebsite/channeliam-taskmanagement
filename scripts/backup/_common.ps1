# Shared helpers for the backup / verify / restore-test scripts.
# Dot-source only. Holds NO credentials: passwords are read with a hidden
# prompt into this process's environment and cleared afterwards.

$ErrorActionPreference = "Stop"

# Read-only queries reused by the backup (production) and the restore test
# (disposable target), so both sides produce comparable CSV files.
$Q_ROW_COUNTS = @"
select table_schema as schema_name, table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint as row_count
from information_schema.tables
where table_type = 'BASE TABLE'
  and (table_schema in ('public', 'private', 'supabase_migrations')
       or (table_schema = 'auth' and table_name in ('users', 'identities', 'mfa_factors'))
       or (table_schema = 'storage' and table_name in ('buckets', 'objects')))
order by 1, 2
"@

$Q_FINGERPRINT = @"
select 'tables' as metric, count(*)::text as value from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ('public','private')
union all select 'policies_app', count(*)::text from pg_policies where schemaname in ('public','private')
union all select 'policies_storage', count(*)::text from pg_policies where schemaname = 'storage'
union all select 'functions', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private')
union all select 'triggers_app', count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public','private')
union all select 'triggers_auth_storage_app', count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace where not t.tgisinternal and n.nspname in ('auth','storage') and pn.nspname in ('public','private')
union all select 'indexes', count(*)::text from pg_indexes where schemaname in ('public','private')
union all select 'table_grants', count(*)::text from information_schema.role_table_grants where table_schema in ('public','private')
union all select 'rls_enabled_tables', count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and c.relrowsecurity and n.nspname in ('public','private')
union all select 'enum_types', count(*)::text from pg_type t join pg_namespace n on n.oid = t.typnamespace where t.typtype = 'e' and n.nspname in ('public','private')
order by 1
"@

# Triggers on auth/storage tables that call app functions, and storage
# policies: pg_dump -n public -n private does not include them.
$Q_EXTRA_OBJECTS = @"
select pg_get_triggerdef(t.oid) || ';'
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal and n.nspname in ('auth','storage') and pn.nspname in ('public','private')
union all
select format('create policy %I on %I.%I as %s for %s to %s%s%s;', policyname, schemaname, tablename, permissive, cmd,
              array_to_string(roles, ', '),
              case when qual is not null then ' using (' || qual || ')' else '' end,
              case when with_check is not null then ' with check (' || with_check || ')' else '' end)
from pg_policies where schemaname = 'storage'
"@

function Assert-PgTools {
    foreach ($t in "pg_dump", "pg_dumpall", "psql") {
        if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { throw "$t not found on PATH." }
        $v = & $t --version
        if ($v -notmatch ' 17\.') { throw "$t must be PostgreSQL 17 (found: $v)." }
    }
}

# Sets libpq environment variables for this process only. The password comes
# from a hidden prompt (or an existing PGPASSWORD) and never touches disk,
# command history or a connection string.
# Every libpq variable that could change who/where we connect. A child
# "powershell -File" inherits the caller's environment, so a PGPASSWORD,
# PGUSER, PGSERVICE etc. left over from earlier manual attempts would
# otherwise silently win. They are all cleared before connecting.
$PG_VARS = "PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE", "PGHOST", "PGHOSTADDR", "PGPORT", "PGUSER",
           "PGDATABASE", "PGSSLMODE", "PGOPTIONS", "PGAPPNAME", "PGCONNECT_TIMEOUT", "PGTARGETSESSIONATTRS"

function Clear-PgConnection {
    foreach ($n in $PG_VARS) { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
}

# Password: hidden prompt by default. -PasswordFromEnv is only for local
# rehearsals (reads TM_LOCAL_PGPASSWORD, never PGPASSWORD).
function Set-PgConnection {
    param([string]$PgHost, [int]$Port, [string]$User, [string]$Database = "postgres", [string]$SslMode = "require", [switch]$PasswordFromEnv)
    $localPassword = $env:TM_LOCAL_PGPASSWORD
    Clear-PgConnection
    $env:PGHOST = $PgHost; $env:PGPORT = "$Port"; $env:PGUSER = $User
    $env:PGDATABASE = $Database; $env:PGSSLMODE = $SslMode; $env:PGAPPNAME = "tm-backup-tooling"; $env:PGCONNECT_TIMEOUT = "15"
    $env:PGPASSFILE = "NUL"   # ignore any pgpass file
    if ($PasswordFromEnv) {
        if (-not $localPassword) { throw "TM_LOCAL_PGPASSWORD is not set." }
        $env:PGPASSWORD = $localPassword
        return
    }
    $secure = Read-Host "Database password for $User (hidden)" -AsSecureString
    if ($secure.Length -eq 0) { throw "No password entered. Stopping." }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Connection preflight: one trivial read-only query, before any file is written.
function Test-PgConnection {
    $ErrorActionPreference = "Continue"
    $out = & psql -X -q -A -t -c "select current_user" 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) {
        $msg = (($out | Out-String).Trim() -replace '(?i)(password=)\S+', '$1***')
        throw ("CONNECTION FAILED as user '$env:PGUSER' at ${env:PGHOST}:$env:PGPORT. Nothing was written.`n$msg`n" +
               "Note: the Supabase pooler names only the role (""postgres"") in this message even when the project-qualified user was sent. " +
               "If the user above is postgres.<project ref>, the password is wrong (use the DATABASE password from Project Settings -> Database).")
    }
    return ($out | Select-Object -Last 1)
}

# Runs one read-only psql statement; output goes to a file written by psql
# itself (UTF-8), never through PowerShell redirection.
function Invoke-PsqlReadOnly {
    param([string]$Sql, [string]$OutFile, [switch]$Csv, [switch]$Raw, [switch]$Write)
    if ($Sql.Contains('"')) { throw "Internal: SQL passed to psql must not contain double quotes (Windows PowerShell mangles them)." }
    $psqlArgs = @("-X", "-q", "-v", "ON_ERROR_STOP=1")
    if (-not $Write) { $psqlArgs += @("-c", "set default_transaction_read_only = on") }
    if ($Csv) {
        $oneLine = ($Sql -replace '\s+', ' ').Trim()
        $target = $OutFile -replace "'", "''"
        $psqlArgs += @("-c", "\copy ($oneLine) to '$target' with (format csv, header true)")
    } elseif ($Raw) {
        $psqlArgs += @("-A", "-t", "-o", $OutFile, "-c", $Sql)
    } else {
        $psqlArgs += @("-A", "-t", "-c", $Sql)
    }
    $ErrorActionPreference = "Continue"   # psql notices on stderr must not abort
    $out = & psql @psqlArgs 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $(($out | Out-String).Trim())" }
    return $out
}

function Import-CsvMap {
    param([string]$Path, [string[]]$KeyColumns, [string]$ValueColumn)
    $map = @{}
    foreach ($r in Import-Csv $Path) { $map[(($KeyColumns | ForEach-Object { $r.$_ }) -join ".")] = $r.$ValueColumn }
    return $map
}
