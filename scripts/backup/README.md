# Production backup and restore test

Scripts in this folder hold no credentials. Passwords and the HR key are typed
into hidden prompts and live only in that PowerShell process.

| Script | Connects to | Writes |
|---|---|---|
| `backup-production.ps1` | Production, **read-only** (pg_dump plus psql with `default_transaction_read_only`) | Backup folder (must be empty) |
| `verify-production-backup.ps1` | Nothing (offline file checks) | Nothing |
| `restore-test-local.ps1` | A **disposable local** Supabase stack only (refuses other hosts) | That stack and `-WorkDir` |
| `pan-decrypt-check.mjs` | Nothing | Nothing (prints counts only) |

Rehearsed end to end on 2026-11-05 against the local dev database (migration
039): the backup, the verification (policies 120/120, triggers 65/65, RLS
31/31, every table's row count) and the restore test (rows, schema
fingerprint, 497/497 table grants, migration history, 4 pg_cron jobs) all passed.

## 1. Connection (cause of the earlier failure)

The Session Pooler username is **`postgres.ptgtsrbaxczphezegial`**, not
`postgres`. With plain `postgres` the pooler cannot tell which project you
mean. This is confirmed by the CLI's own saved pooler URL
(`supabase/.temp/pooler-url`).

* Host `aws-0-ap-northeast-1.pooler.supabase.com`, port `5432` (session mode), database `postgres`, SSL required.
* The password is the **database password** (Dashboard → Project Settings → Database). It is not your Supabase login, the anon key or the service key.
* The scripts never build a connection string. They set `PGHOST`, `PGUSER` and the other libpq variables for the process, so special characters in the password (`@ : / # ? % $` and backtick) need no escaping. In URLs those characters would need percent-encoding, and in double-quoted PowerShell strings `$` and backtick get changed silently.
* If it still says `password authentication failed` with the correct username, the password is wrong. Only a reset fixes that (Dashboard → Database → Reset database password), and it needs the owner's approval because anything using the old password stops working. The app itself uses API keys, not this password.

## 2. Take the backup (you run this)

```powershell
cd "%USERPROFILE%\Desktop\TaskManagement\taskmanagement"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\backup-production.ps1
```
It asks for the database password (hidden), checks that production is at 036
and PostgreSQL 17, then writes the following into
`%USERPROFILE%\TaskManagement-Backups\prod-036-2026-11-05`:

| File | Contents |
|---|---|
| `00-manifest.json` | Time, versions, step results, what is NOT included |
| `01-roles.sql` | Roles and memberships (no passwords) |
| `02-schema.sql` | `public`, `private` and `supabase_migrations`: tables, functions, triggers, indexes, constraints, RLS policies, grants, default privileges |
| `03-auth-storage-objects.sql` | App triggers on `auth.users`, and `storage.objects` policies (not covered by the schema dump) |
| `04-data.sql` | All rows of those schemas, plus `auth.users`, `auth.identities`, `auth.mfa_factors`, `storage.buckets` and `storage.objects` (metadata) |
| `05-migration-history.csv` | 001–036 |
| `06-cron-jobs.csv` | pg_cron job names, schedules and commands |
| `07-row-counts.csv`, `08-fingerprint.csv` | Live counts used by verification and the restore test |
| `09-storage-buckets.csv`, `10-storage-objects.csv` | Bucket settings, and a list of stored files |
| `11-extensions.csv` | Installed extensions |
| `SHA256SUMS.txt` | Checksums of all of the above |

Then verify it (offline):
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\verify-production-backup.ps1
```
Only rely on the backup when it ends with **DATABASE BACKUP VERIFIED**.

The folder contains employee personal data, auth password hashes and
encrypted PAN values. Keep it on an encrypted drive (BitLocker, or a 7-Zip
AES-256 archive) with one off-site copy. Never put it in Git, OneDrive
sharing or chat.

## 3. Restore test (needs your approval; never use staging)

```powershell
# a) Free memory: stop the project's dev stack.
cd "%USERPROFILE%\Desktop\TaskManagement\taskmanagement"; npx supabase stop

# b) Create an empty disposable stack on ports 558xx (no migrations in it).
mkdir C:\tm-restore; cd C:\tm-restore; npx supabase init
$c = (Get-Content supabase\config.toml) -replace '\b543(\d\d)\b','558$1' -replace '^project_id = ".*"','project_id = "tm-restore"'
[IO.File]::WriteAllLines("C:\tm-restore\supabase\config.toml", $c)
npx supabase start -x realtime,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor

# c) Restore and compare (asks for the HR key, hidden, for the PAN check).
cd "%USERPROFILE%\Desktop\TaskManagement\taskmanagement"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\restore-test-local.ps1 -Confirm "RESTORE TO DISPOSABLE"

# d) Destroy the disposable copy (it holds production data).
cd C:\tm-restore; npx supabase stop --no-backup; cd ..; Remove-Item -Recurse -Force C:\tm-restore
```
What it checks: the backup verifies first; it loads everything in one
transaction (rolled back on any error); it re-creates the pg_cron jobs; then it
compares row counts for every table (including auth users), the schema
fingerprint (tables, functions, triggers, indexes, policies, RLS, grants,
enums), migration history and cron jobs. Finally it decrypts every PAN with the
separately kept key and prints only the number that decrypted. Expected result:
**RESTORE TEST PASSED**.

Restoring into a real new Supabase project after a disaster works the same way.
Run steps 3–5 of the script by hand against that project's database URL; its
target-host guard deliberately refuses non-local hosts.

## 4. Not covered by database dumps (manual)

| Item | How |
|---|---|
| Storage **files** | Download each file in `10-storage-objects.csv` (Dashboard → Storage). Expected: none; the photo upload screen was removed |
| Auth settings: Site URL, redirect URLs, email templates, SMTP, JWT expiry | Write them down from Dashboard → Authentication. Templates are in `supabase/templates/` |
| API keys, database password | Password manager only |
| `HR_ENCRYPTION_KEY` and `_VERSION` | Password manager, separate from the backups (without it PAN cannot be decrypted) |
| Vercel environment variables | Record the names per environment; keep values in the password manager |
| Auth sessions and refresh tokens | Deliberately not backed up; users simply sign in again |
| Automatic backups | Not available on the Free plan; repeat this procedure before every migration and weekly |
