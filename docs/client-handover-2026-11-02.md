# TaskManagement — Final Test Report and Handover Pack

Prepared 2 November 2026. Contains no passwords, keys or connection strings.

Production domain: **https://taskmanager.likesandshares.com**

Status: **NOT READY FOR CLIENT ACCEPTANCE.** The application passes every automated
check and the production domain resolves and serves the app. However, the
production site runs older code, and the production database is missing the
migrations the current code needs. See section 3.

Correction (2 Nov 2026): an earlier version of this report used the wrong domain,
`taskmanager.channeliam.com`, and reported it as not resolving. The correct
domain is `taskmanager.likesandshares.com`; sections 2, 3, 5 and 7 are updated.

---

## 0. Release audit status (latest, 2 Nov 2026)

| Area | Status | Evidence |
|---|---|---|
| Production backup | **Partly verified** | `TaskManagement-Backups\2026-10-31\`: `roles.sql`, `schema.sql`, `data.sql`, `application-schema.sql`, `application-data.sql`. All end with "dump complete", made with PostgreSQL 17.11 on 31 Oct 2026 11:30–11:51 IST.<br>Tied to production: it records history 001–023, 2 auth users and 17 public tables, the same as the live check.<br>Only the anonymised public data has been restored (on staging, 107 rows). A full restore including auth has not been tested.<br>The files contain password hashes and session tokens, so store them securely. |
| Migration history | **Pass** | Live production: exactly 001–023. |
| Schema compatibility | **Pass (as of 31 Oct); live drift check pending** | The production `public`/`private` schema dump is line-for-line identical to a clean 001–023 build, apart from pg_dump's random restrict token.<br>Also confirmed in the backup: both `auth.users` triggers, the `tasks_project_id_fkey` constraint that 027 replaces, and the policies that 025 and 029 replace.<br>A live fingerprint check (`08-prod-schema-fingerprint.sql`) is ready, with reference values from a clean 001–023 build. |
| Data compatibility | **Pass (by design)** | 024–031 add no constraint that existing rows could violate. 027 re-creates an existing foreign key, 028 adds a column with a constant default, and 029's new check applies only to new, empty columns. |
| Migrations 024–031 | **Ready** | Rehearsed twice from a 023 state:<br>• one file at a time, giving history 001–031, 38/38 objects, and a schema fingerprint identical in 9/9 categories;<br>• the production runner (`09-run-migrations.ps1`) dry-run on a second 023 database: 8/8 applied, verified and recorded; re-run refused; fingerprint identical. |
| Tests (against the upgraded rehearsal) | **Pass** | pgTAP 803/803 (27 files), unit 180/180, type check, ESLint and production build all pass. |
| Code deployment | **Blocked until the database is migrated** | Production is `main` at `0bfe2fd`. The new code needs 024–031 and isn't committed (45 modified, 24 untracked files). |

Order for release:
1. Run the live 08 drift check.
2. Take a fresh backup.
3. Apply 024–031 with `09-run-migrations.ps1 -Target production`.
4. Commit, push, open a PR and merge to `main` (Vercel deploys).
5. Smoke-test as each role.

## 1. Final test report

All runs on 2 Nov 2026 against the current working tree (branch
`feature/stage1-bugs-report-history`, HEAD `086ce39` plus uncommitted Stage 1 and
Phase 2 work), using the local Supabase stack. Nothing ran against production.

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | PASS (0 errors) |
| ESLint | `npm run lint` | PASS (0 problems) |
| Unit tests | `npm test` | PASS 180 / 180 |
| Database tests (pgTAP, local) | `npx supabase test db --local` | PASS 803 / 803 in 27 files |
| Production build | `npm run build` (local Supabase env) | PASS, 24 routes |
| Functional API test (local, seed accounts) | scratchpad `local-functional.mjs` | PASS 27 / 27 |
| Role page check (local production build) | Super Admin, Admin and Individual sign-ins | PASS |

Functional API test, executed (real Supabase Auth and API, local stack):

- Attendance: check-in; check-out; duplicate check-in refused; check-out with no open session refused; check-in to a non-member workspace refused; direct insert and update of attendance rows refused; CHECK_IN and CHECK_OUT audit events written; Individuals see only their own records; Admins see none of another employee's records or audit entries; Super Admin sees company-wide; anonymous callers can neither call the functions nor read the tables.
- Tasks: Admin creates and assigns a task; the Individual sees it, updates status and progress, and comments; the Individual cannot edit other fields or reassign; the Individual sees no tasks in a workspace they don't belong to.
- Reports: the Individual submits a morning plan and an evening report; the Super Admin cannot submit reports (by design).
- Notifications: the Individual reads their own notifications.

Role page check, executed (server-rendered output):

- **Super Admin:** company overview across both workspaces, Team Today, attendance.
- **Admin:** Team section, review queue, client creation, team calendar, attendance.
- **Individual:** no Team section in the navigation, and `/team` and `/team-today` redirect to My Day. Daily Update, clients and settings render.

Not executed:

- Interactive clicking, mobile layout and workspace switching in a visible browser (the preview pane did not paint).
- Anything on staging or production through the app.
- Email delivery (invites and password reset).
- Scheduled jobs.

## 2. Deployment status

| Item | Finding |
|---|---|
| GitHub repository | `channeliamwebsite/channeliam-taskmanagement`. It is **public**; no secrets are committed (checked). |
| Production branch | `main` at `0bfe2fd` (28 Oct 2026). |
| Latest production deployment | `0bfe2fd`, Vercel status **success** (28 Oct 2026, 07:01 UTC). |
| Vercel project | `channeliam-taskmanagement` (linked through `.vercel/repo.json`). |
| `channeliam-taskmanagement.vercel.app` | Responds (HTTP 200 on `/login`). |
| **`taskmanager.likesandshares.com` DNS** | **Verified, resolves.** `likesandshares.com` uses GoDaddy name servers (`ns21`/`ns22.domaincontrol.com`). The authoritative answer is `CNAME taskmanager → 646223bfa179aff0.vercel-dns-017.com`, which resolves to Vercel addresses 64.29.17.65 and 216.198.79.65. |
| **`taskmanager.likesandshares.com` HTTPS** | **Verified, works.** `/login` returns HTTP 200 from `Server: Vercel` with page title "Sign in · Channeliam"; `/` returns 307 to sign-in. The certificate was accepted by the client. |
| Same deployment as the production alias | **Verified.** The domain and `channeliam-taskmanagement.vercel.app` serve identical static asset sets (fingerprint `e815f606fd64`). |
| Domain attached to project `channeliam-taskmanagement` | **Inferred, not confirmed.** The identical assets strongly indicate the same project. Confirming it needs the Vercel dashboard (Project → Settings → Domains). |
| Commit served by the domain | **Not confirmed.** The latest production deployment is `0bfe2fd`, but its deployment URL is behind Vercel authentication. Confirm in Vercel → Deployments. |
| Latest intended code | **Not deployed.** Two local commits (`ea0578e`, `086ce39`) and all Stage 1 and Phase 2 changes are not pushed or committed. |
| Vercel environment variables, build logs, domain settings | **Not checked.** The Vercel CLI isn't installed, and no Vercel access token is available in this session. Requires the Vercel dashboard. |
| Supabase project used by the live site | **Not confirmed.** The sign-in page doesn't expose it. Check that `NEXT_PUBLIC_SUPABASE_URL` in Vercel (Production) names `ptgtsrbaxczphezegial`. |

## 3. Outstanding bugs and blockers

| # | Severity | Issue | Evidence | Fix | Approval |
|---|---|---|---|---|---|
| B1 | Closed | (Withdrawn) The earlier report checked the wrong domain. | `taskmanager.likesandshares.com` resolves to Vercel and serves the app over HTTPS (section 2). | None. Optionally confirm in the Vercel dashboard that the domain shows "Valid Configuration" on project `channeliam-taskmanagement`. | No |
| B1a | High | The live site runs older code. | Production is `main` at `0bfe2fd`; the attendance, Stage 1 and Phase 2 work isn't deployed. | Deploy only after B2–B5 (section 4). | Yes |
| B2 | Critical | The production database lacks migrations 024–031, which the current code needs. | The 31 Oct 2026 production schema backup has no `attendance_sessions`, `is_company_admin`, `meeting_participants`, `project_collaborators` or `can_create_clients_projects`; the current code queries all of them. | Use the migration plan in section 4 before deploying the code. | Yes |
| B3 | Closed | Production migration history was read directly on 2 Nov 2026. | Read-only check run by the project owner: history exactly 001–023; 0 of the 38 selected 024–031 objects; 17 public tables; 2 auth users. | None. | No |
| B10 | High | Leave requests/approvals and payroll don't exist in the app. | No leave or payroll tables, functions or pages in `src` or the migrations. They were deliberately deferred as restricted HR features (decided 30 Oct 2026). | Agree the scope with the client before acceptance. Build them as a separate HR milestone. | Yes |
| B11 | High | No fresh production backup exists for the migration window. | The newest backup is from 31 Oct 2026 11:31–11:51 IST. Only its anonymised public data has been restored (on staging). | Take a fresh full backup immediately before applying 024–031 (section 0). | Yes (you run it) |
| B4 | High | The current code isn't committed, pushed or reviewed. | 68 changed or new files on the feature branch. | Commit Stage 1 and Phase 2 separately, open a PR to `main`, and review the Vercel preview. | Yes |
| B5 | High | Undo scripts for 024–031 don't exist, and 026/027 can't be re-run. | Earlier release audit. | Write and rehearse undo scripts on staging. | Yes |
| B6 | Medium | A Super Admin's active workspace can be one they aren't a member of, so check-in is refused there. | `src/lib/data/workspace.ts:56` lists every workspace for a Super Admin, but check-in requires membership (024). | Have the Attendance page choose from the user's memberships only. | Yes |
| B7 | Medium | Scheduled jobs run on staging. | `daily-morning-reports` (every 15 min) and `daily-task-reminders` from 006/011. | Decide whether to unschedule them on staging. | Yes |
| B8 | Low | No pgTAP test for anonymous access to attendance. | Verified manually instead (section 1). | Add 3 assertions to `attendance_core.test.sql`. | Yes |
| B9 | Low | The staging object fingerprint hasn't been compared yet. | `06-staging-output.txt` hasn't been produced. | Run `06-staging-verify.sql` on staging. | No (read-only) |

## 4. Production migration requirements

The current code needs, in this order (no renumbering):

- `024_attendance_core`: attendance tables and the check-in/check-out functions.
- `025_company_admin_authorization`: Super Admin works company-wide (permission change).
- `026_company_audit_events`: company-level audit events. Not re-runnable.
- `027_archive_not_delete`: tasks with history are cancelled, not deleted. Not re-runnable.
- `028_individual_clients_projects`: `can_create_clients_projects` flag (default off).
- `029_meeting_participants`: meeting participants, descriptions and end times.
- `030_project_collaborators`: project collaborators.
- `031_protect_meeting_records`: meetings that have meeting records can't be deleted.

### 4a. Production migration status (checked 2 Nov 2026)

| Finding | Status | Evidence |
|---|---|---|
| Local migration files 024–031 exist and are unchanged | **Confirmed** | 8 files in `supabase/migrations`, SHA256 prefixes: `185450E57833` (024), `0ADD9214B2A6` (025), `0E3FC4B193B7` (026), `AEA190B1261A` (027), `C48776EB44EB` (028), `53F31CB16D6B` (029), `E1FAF244DD43` (030), `EE9512E2B6E4` (031). |
| Production migration history (`supabase_migrations.schema_migrations`) | **Not verified** | No production credential is available to the assistant: `PROD_DB_URL` and `SUPABASE_ACCESS_TOKEN` are not set in any scope, and there's no Supabase CLI access token. `--linked` and `.env.local` were deliberately not used. |
| Production lacks the objects of 024–031 | **Assumption (strong)** | The production schema backup of 31 Oct 2026 contains none of the objects new in 024–031, while it contains the objects of 015–023. The backup is two days old and can't prove what has happened since. |
| Production has 015–023 | **Assumption** | Their named objects are present in the same backup; their history entries are not verified. |
| Read-only check is ready | **Confirmed (locally)** | `07-prod-migration-check.sql` (SHA256 `a1e29208…`) and `prod-readonly.sh` (SHA256 `d7f74b24…`).<br>• The session is forced read-only and runs as one transaction.<br>• The wrapper accepts only a `postgres://` or `postgresql://` URL for `db.ptgtsrbaxczphezegial.supabase.co` (user `postgres`) or a `*.pooler.supabase.com` host with user `postgres.ptgtsrbaxczphezegial`. The only query parameter allowed is `sslmode`; staging and everything else is refused.<br>• 29/29 guard tests passed with fake URLs.<br>• A local run found all 38 objects present. A write in a read-only session was refused. |

Objects introduced by 024–031, which the check looks for (presumed missing in production):

- **024:**
  - tables `attendance_sessions`, `attendance_audit_log`;
  - functions `attendance_check_in`, `attendance_check_out`, `private.is_super_admin`, `private.log_attendance`;
  - unique index `attendance_sessions_one_open_idx`;
  - two SELECT policies;
  - the `btree_gist` extension.
- **025:**
  - function `private.is_company_admin`;
  - company-admin read policies on workspaces, workspace members, profiles, clients, projects, tasks, meeting links and activity logs;
  - redefined role helpers.
- **026:**
  - enum values `WORKSPACE_CREATED` and `WORKSPACE_UPDATED`;
  - `log_workspace_audit` function and trigger;
  - `activity_logs.workspace_id` becomes nullable.
- **027:**
  - `task_has_history`, `protect_task_history` and `protect_project_history` functions and triggers;
  - the task-to-project foreign key changes to `NO ACTION`.
- **028:**
  - column `workspace_members.can_create_clients_projects`;
  - `individual_may_create`;
  - client and project policies for Individuals.
- **029:**
  - table `meeting_participants`;
  - columns `meeting_links.description` and `meeting_links.ends_at`, and `notifications.meeting_link_id`;
  - `MEETING_*` notification values;
  - meeting functions, triggers and policies.
- **030:**
  - table `project_collaborators`;
  - `COLLABORATOR_*` activity values;
  - collaborator functions, triggers and policies.
- **031:** `protect_meeting_records` function and trigger.

How to run the read-only check (you, in your own PowerShell window, with `PROD_DB_URL` set to the production session-pooler connection string):

1. Confirm the target. This must print `True`:
   `$env:PROD_DB_URL -match 'ptgtsrbaxczphezegial' -and $env:PROD_DB_URL -notmatch 'zjldhnfsjdnpeolqxqmc'`
2. Run the check (it prints only versions, object names, counts and booleans):
   `docker exec -e PROD_DB_URL supabase_db_taskmanagement sh /tmp/prod-readonly.sh /tmp/07-prod-migration-check.sql`
3. Expected if the assumption holds:
   - P1 `read_only = on` and `staging_demo_users = 0`;
   - P2 `present = t` (the history table exists);
   - P3 `present = 0` for 024–031;
   - P5 (last) history 001–023. If the history table doesn't exist, P5 alone fails after P1–P4 have printed.

Safe plan (each step needs explicit approval; none has been done):

1. **Read-only check of production.** Read the migration history (expected: 001–023 recorded). Confirm `btree_gist` is available and pg_cron jobs exist.
2. **Fresh backup.** Take a fresh production backup and verify its checksums. Restore-test it on staging (B3/B5).
3. **Staging rehearsal.** Apply 024–031 on staging, run the pgTAP suite with `--db-url` against staging, and smoke-test a Vercel preview pointed at staging.
4. **Production maintenance window.**
   - Apply 024–031 one file at a time, each in one transaction (`psql --single-transaction -v ON_ERROR_STOP=1`).
   - Record each in the history with `supabase migration repair <ver> --status applied --db-url …`.
   - Never use `--linked` or `db push`.
5. **Deploy.** Merge the reviewed PR to `main`. Vercel deploys automatically.
6. **Post-deploy.** Smoke-test as each role, and confirm the attendance functions and RLS with read-only queries.

Database first, then code: the deployed code (`0bfe2fd`) doesn't depend on 024–031, while the new code fails without them.

## 5. Client acceptance checklist

- [ ] `https://taskmanager.likesandshares.com` loads over HTTPS and shows the sign-in page.
- [ ] Super Admin: dashboard shows the company overview (all workspaces), employee task counts, overdue and blocked work, and report status.
- [ ] Super Admin: Team Today, Employees, Daily Updates (morning versus evening comparison) and report history.
- [ ] Super Admin: create a workspace, invite an employee, set roles, deactivate (not delete) an employee.
- [ ] Admin: create a task, assign one or more people, set due dates, review work in "Awaiting your review".
- [ ] Admin: create and manage clients and projects; add project collaborators (Super Admin grants).
- [ ] Admin and Super Admin: schedule a meeting with participants; participants are notified and see it in the calendar.
- [ ] Individual: My Day shows assigned tasks; update status and progress; comment; attach a file.
- [ ] Individual: submit a morning plan and an evening report; they appear for Admins and the Super Admin.
- [ ] Everyone: check in and check out on Attendance; the history and calendar update; a second check-in is refused.
- [ ] An Individual cannot open Team pages or see other employees' attendance.
- [ ] Notifications arrive in the Inbox for assignments, comments and meetings.
- [ ] Archiving a project, or cancelling a task that has history, works; deleting it is refused with a clear message.
- [ ] Bug Reports: an employee files a bug, and the Super Admin sees it.
- [ ] Phone layout (about 375 px wide): the navigation menu opens, and pages don't scroll sideways.

## 6. User account and role setup checklist

- [ ] At least **two** active Super Admins (the system refuses to remove the last one).
- [ ] One workspace per department; name and timezone set (default Asia/Kolkata).
- [ ] Each Admin added to their department's workspace; "may create projects" set where needed.
- [ ] Each Individual added to their workspace; "may create clients and projects" only where agreed (off by default).
- [ ] Each employee's manager, department, team and job title filled in.
- [ ] Super Admins who will record attendance are members of a workspace.
- [ ] Former employees deactivated, not deleted; their history stays.
- [ ] Invitation emails received; each person sets their own password (nobody shares passwords).
- [ ] Remove staging demo accounts; they must never exist in production.

## 7. Client handover message (draft — send only after B1a–B5 are resolved)

> Hello,
>
> The TaskManagement system is ready for your acceptance review at
> https://taskmanager.likesandshares.com.
>
> Each team member will receive an invitation email to set their own password.
> Super Admins see company-wide progress and attendance; Admins create and assign
> tasks, manage clients and review their team's work; team members update their
> tasks, submit morning plans and evening reports, and record attendance.
>
> Attached is an acceptance checklist covering each role. Please work through it
> and send us anything that doesn't behave as expected, using the Bug Reports page
> in the app or by replying to this email.
>
> Thank you.

## 8. Exact next steps (in order)

Steps 1–2 need dashboard access. Steps 3–9 each need explicit approval before they run.

1. **Vercel dashboard (read only).**
   - Project `channeliam-taskmanagement` → Settings → Domains: confirm `taskmanager.likesandshares.com` is listed with "Valid Configuration".
   - Deployments: confirm the current production deployment is commit `0bfe2fd`.
   - Settings → Environment Variables (Production): confirm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` exist, and that the URL names project `ptgtsrbaxczphezegial` (don't copy the values anywhere).
   - Settings → Git: confirm the production branch is `main`.
2. **GoDaddy DNS (read only).** Confirm the `taskmanager` CNAME to Vercel is the intended record. No change is needed.
3. **Production migration history (read only).** Run the check in section 4a with `prod-readonly.sh` (never `--linked`). Expected: 001–023 recorded, 024–031 absent (B2/B3). Vercel dashboard checks (steps 1–2) were reported complete by the project owner on 2 Nov 2026.
4. **Fresh production backup.** Verify its checksums and restore-test it on staging (B5).
5. **Staging rehearsal of 024–031.**
   - Run `06-staging-verify.sql` and compare it with the local reference (B9).
   - Run the pgTAP suite against staging with `--db-url`.
   - Smoke-test a Vercel preview pointed at staging.
6. **Commit and review.** Commit Stage 1 and Phase 2 separately, open a PR to `main`, and review the preview deployment (B4).
7. **Production migrations.** In an approved window, apply 024–031 one file at a time with `--single-transaction`, recording each with `migration repair --db-url`.
8. **Deploy.** Merge the PR to `main`; Vercel deploys to `taskmanager.likesandshares.com`.
9. **Acceptance.** Run section 5 on the live domain as each role, then send the message in section 7.

The production migration gap for 024–031 remains a blocker until steps 3–7 are done.
