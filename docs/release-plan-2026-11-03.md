# TaskManagement — release status and plan for 3 November 2026

Internal working notes. Not committed: the GitHub repository is public.

## Where things stand (end of 2 November)

| Item | State |
|---|---|
| Feature branch | `feature/stage1-bugs-report-history` at `2710d4a`, pushed; 8 commits ahead of `main` |
| Vercel preview | Built for `2710d4a` (deployment 7490008187); behind Vercel login, not yet tested by a person |
| Production app | `main` at `0bfe2fd` on https://taskmanager.likesandshares.com (unchanged) |
| Production database | Migrations 001–023 (verified read-only on 2 Nov). Nothing applied. |
| Local database | 001–032 |
| Pull request | None yet |

Commits on the branch not in `main`:
1. `ea0578e` admin guards and audit, migrations 015–023 (already applied in production);
2. `086ce39` attendance (024);
3. `7d606a3` Stage 1: one Bug Report entry, full report history;
4. `00122b7` Phase 2 (025–031);
5. `d0575cd` `npm run dev:local`;
6. `f0b97c7` password reset fixed, admin reset links, deactivation hardening (032);
7. `2710d4a` accurate messages for rejected links.

## Verified locally on 2 November (latest code)

- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 192/192.
- `npm run db:test`: 839/839 in 28 files.
- `npm run build` (local Supabase values): passes, 25 pages.
- `node scripts/test-employee-auth.mjs` with `APP_URL` against a local build: 25/25.
  - It covers: invite → password; reset link → new password; used and unknown links refused; reset email delivered with the app link; ban blocks sign-in and refresh; a valid token reaches no data after deactivation; reactivation; the `/auth/confirm` redirects and messages.
- API role and security probes with the seed accounts: 27/27 and 32/32.

## Pending issues

| # | Severity | Issue | Next step |
|---|---|---|---|
| P1 | Blocker | Production database lacks 024–032; the new code needs them | Production migration (section A) |
| P2 | Blocker | Supabase Auth dashboard settings on the production project are unverified, so invitation and reset emails may not work there | Section B |
| P3 | High | Production tooling covers 024–031 only | Add 032, then rehearse (section A, step 1) |
| P4 | High | Fresh backup needed on the day; a full restore has never been tested | Section A, step 2 |
| P5 | High | Preview not tested by a person | Section C |
| P6 | Medium | Leave requests/approvals and payroll do not exist | Agree scope with the client; separate HR milestone |
| P7 | Medium | A Super Admin whose active workspace is not one of their memberships cannot check in there | Small fix: attendance picks a membership workspace |
| P8 | Low | Super Admins can create tasks (025 design) although the brief says they need not | Confirm with the client; hide the action if wanted |
| P9 | Low | Mobile layout not checked visually (the browser pane could not draw on this machine) | Check on a phone during preview testing |
| P10 | Info | This machine has 7.3 GB RAM. Builds and Docker run out of memory when many apps are open | Close other apps; keep the rehearsal stacks stopped |

Not committed on purpose: `docs/` (internal) and a one-line line-ending change in `src/lib/data/errors.ts` (not part of this work).

## Tomorrow's plan

### A. Production database (needs explicit approval at step 4)

1. **Bring the reviewed tooling up to 032.** The tooling is in the scratchpad `staging-restore` folder.
   - `prod-apply.sh`: add `032_inactive_accounts_no_access.sql` to the allowlist.
   - `09-run-migrations.ps1`: range 24..32, and read the 032 hash from `TaskManagement-Backups\migrations-032-2026-11-02\SHA256SUMS.txt` (SHA-256 `E4BAD294…F55662`).
   - `07-prod-migration-check.sql`: add 032's six policies to P3.
   - Re-run the guard tests, then review the new hashes.
2. **Rehearse 024–032 on a 023-state database.** `tm-ref023` is at 031 now, so reset it to 001–023 first (move its 024–031 copies aside), then run `09-run-migrations.ps1 -Target ref023`.
   - Expect: history 001–032, all objects present, and the fingerprint equal to the local stack's.
3. **On the day:** take a fresh backup (`supabase db dump --db-url $env:PROD_DB_URL`, three files) and run `09-run-migrations.ps1 -Target production -CheckBackupOnly -BackupDir <new folder>`.
4. **With approval:** `09-run-migrations.ps1 -Target production -Confirm "APPLY TO ptgtsrbaxczphezegial" -BackupDir <new folder>`.
5. **Afterwards:** run the read-only checks `07` and `08` (expect history 001–032).

### B. Production Supabase Auth settings (dashboard, with the project owner)

1. **Site URL:** `https://taskmanager.likesandshares.com`.
2. **Redirect URLs:** add `https://taskmanager.likesandshares.com/auth/confirm`.
3. **Email templates:** paste `supabase/templates/invite.html` into *Invite user*, and `supabase/templates/recovery.html` into *Reset password*.
4. **Custom SMTP:** configure it. The built-in sender only delivers to project team members and is limited to a few emails per hour.
5. **Test:** send a reset email to a real test mailbox.

### C. Preview testing (before merging)

1. Open the preview URL (Vercel login needed).
2. Check which Supabase project the Preview environment uses (Vercel → Settings → Environment Variables → Preview).
   - **If it is production:** pages that need 024–032 will error until section A is done. Test the preview after A, or point Preview at staging.
3. Run the acceptance checklist in `client-handover-2026-11-02.md` section 5 as each role, including Forgot password and Send password reset link.

### D. Release

1. Open a pull request from the feature branch to `main`; review the diff and the preview.
2. Merge only after A and B are done (database first, then code). Vercel then deploys production.
3. Smoke-test the live domain as each role, then send the client handover message.
