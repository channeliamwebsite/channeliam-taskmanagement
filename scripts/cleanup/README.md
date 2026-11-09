# Full reset (fresh start keeping only the Super Admins)

> **PLACEHOLDERS:** the Super Admin emails in these scripts are `super-admin-1@example.com` /
> `super-admin-2@example.com` (this repository is public). Put the real addresses into a local,
> uncommitted copy before running; with the placeholders the scripts stop at their first check.

Keeps `super-admin-2@example.com` (SUPER_ADMIN), the schema, 39 migrations,
functions, triggers, indexes, RLS policies, grants, extensions, the 4 pg_cron
jobs, `hr_settings`, `hr_leave_policies` and the `hr-photos` bucket. Removes
everything else. Nothing here has been run yet.

| File | What it does |
|---|---|
| `production-full-reset.sql` | Database rows, one transaction, **ends with ROLLBACK** |
| `delete-auth-and-storage.mjs` | Other Auth accounts and storage files via the Admin / Storage APIs; **dry run by default** |
| `verify-full-reset.sql` | Read-only PASS/FAIL checks afterwards |

## Deletion order
1. Preconditions (abort if the Super Admin is missing/inactive/not SUPER_ADMIN,
   Auth user count differs from the expected 5, migrations are not 39, cron jobs
   are not 4, or HR configuration is missing).
2. `SET LOCAL app.allow_history_deletion = 'on'` (016's own switch).
3. `client_reports` (its 038 guard disabled for that single DELETE, then re-enabled), `client_report_settings`.
4. `notifications`, `bug_reports`, `attendance_audit_log`, `attendance_breaks`, `attendance_sessions`,
   `hr_leave_applications`, `hr_leave_allowances`, `hr_employee_identity`, `hr_employee_profiles`,
   `hr_public_holidays`, `daily_reports`.
5. `meeting_records`, `meeting_participants`, `meeting_links`.
6. `time_entries`, `task_dependencies`, `task_attachments`, `task_comments`, `task_assignees`, `tasks`.
7. `workspaces` (cascades: projects incl. General, project_collaborators, clients, workspace_members).
8. `activity_logs`.
9. All `profiles` except the Super Admin; `activity_logs` again.
10. Verification (before/after counts, structure fingerprint, guard re-enabled), then ROLLBACK.
11. Separately: `delete-auth-and-storage.mjs` removes the other Auth users (with their identities) and storage files.

## Rehearsal on STAGING (changes nothing)
Staging has the same schema at 039 plus the QA data. For the rehearsal set
`keep_email` / `expected_auth_users` in section 0 to an account that exists on
staging (e.g. `qa-superadmin@channeliam-qa.test` and the staging user count);
restore the production values afterwards.

1. Before: download test exports with the QA data (Client Reports PDF + Excel,
   HR -> Monthly Reports Excel) and spot-check them against the pages.
2. Run (prompts for the staging database password):
   ```
   psql "host=<staging pooler host> port=5432 dbname=postgres user=postgres.zjldhnfsjdnpeolqxqmc sslmode=require" -v ON_ERROR_STOP=1 -f scripts/cleanup/production-full-reset.sql
   ```
3. Expect `VERIFIED: ...` and the before/after table, then `ROLLBACK`.
4. Confirm nothing changed: run the same psql connection with
   `-c "select count(*) from public.tasks; select count(*) from public.profiles;"` (counts as before).
5. Auth/storage dry run: `node scripts/cleanup/delete-auth-and-storage.mjs --env .env.staging --ref zjldhnfsjdnpeolqxqmc`
   (lists what would be deleted; changes nothing).
6. Optional full staging reset (only with approval; it removes the QA data):
   change ROLLBACK to COMMIT, run, run step 5 with `--confirm`, run `verify-full-reset.sql`,
   then sign in as the kept Super Admin: expect "Create your first workspace" on the
   Dashboard; create a workspace and an employee to prove the fresh start works.

## Production (only after approval)
1. Fresh verified backup at 039 (`scripts/backup/backup-production.ps1 -ExpectedMigration 039`).
2. Save client reports and monthly attendance exports outside Supabase.
3. Production values in section 0 (`super-admin-2@example.com`, `5`), ROLLBACK -> COMMIT, run.
4. `delete-auth-and-storage.mjs` dry run, then with `--confirm`.
5. `verify-full-reset.sql`: every line PASS.
6. Sign in as the Super Admin, create the new workspace.

## Rollback / recovery
* Before COMMIT: ROLLBACK (the default) undoes everything.
* After COMMIT: restore from the verified backup (`scripts/backup/README.md`, restore
  procedure) into a new project or, after review, this one. Deleted Auth users are in
  the backup's `auth.users` / `auth.identities` data.
