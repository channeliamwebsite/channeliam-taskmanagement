// Races two database sessions against the LOCAL Supabase database to check the
// guards that pgTAP (one rolled-back transaction per file) cannot exercise
// concurrently:
//   1. last active super admin (015/021): two super admins demote each other;
//   2. task assignees (022): two managers remove the last two assignees.
//
// How contention is proven (no timing thresholds):
//   * a "gate" session holds an advisory lock;
//   * the HOLDER session runs its protected change, then waits on the gate
//     while still holding every lock its change took;
//   * only when the holder is seen waiting on the gate does the WAITER start;
//   * an observer must then see, in pg_stat_activity, the waiter waiting on a
//     lock (wait_event_type = 'Lock') with the holder's pid in
//     pg_blocking_pids(waiter). Only then is the gate released.
//   If that state is not observed within the timeout, the test FAILS (the
//   operations did not contend, so the race would have proven nothing).
//
// What it changes (local database only), and what stays behind:
//   * commits throwaway fixtures (5 @race.test accounts, one workspace, one
//     task) and deletes exactly those again;
//   * for race 1, deactivates every other active super admin (the guard counts
//     company-wide) for the duration of that race and reactivates exactly
//     those rows. This leaves, outside the fixture workspace, a new
//     updated_at on those profiles and two audit entries per workspace they
//     belong to (EMPLOYEE_DEACTIVATED, EMPLOYEE_REACTIVATED, no actor). The
//     audit entries are kept on purpose.
//   * before deactivating anyone it writes a recovery file (profile ids and
//     the SQL to reactivate them) to the OS temp directory, and removes it
//     only after verifying they are active again.
//
// Safety:
//   * connects only through: docker exec -i supabase_db_taskmanagement psql -U postgres -d postgres
//     (never a URL, environment variable, linked project or other container);
//   * refuses to start if fixtures or a recovery file from an earlier run exist;
//   * Ctrl+C / SIGTERM run the same restore-then-cleanup path, best effort; a
//     forced kill cannot be handled, in which case use the recovery file.
//
// Usage: node scripts/test-guard-races.mjs

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Target: the local container of THIS project, verified before any write
// ---------------------------------------------------------------------------
const EXPECTED_PROJECT_ID = "taskmanagement";
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
if (projectId !== EXPECTED_PROJECT_ID) {
  console.error(`Refusing to run: supabase/config.toml project_id is ${JSON.stringify(projectId)}, expected "${EXPECTED_PROJECT_ID}".`);
  process.exit(2);
}
const CONTAINER = `supabase_db_${EXPECTED_PROJECT_ID}`;
const PSQL = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"];

const RUN = randomBytes(4).toString("hex");
const RECOVERY_PREFIX = "taskmanagement-race-recovery-";
const RECOVERY_FILE = path.join(tmpdir(), `${RECOVERY_PREFIX}${RUN}.json`);
const GATE_KEY = 727274001; // advisory lock used only by this script
const WAIT_MS = 20000;

const SA_A = "8e100000-0000-4000-8000-000000000001";
const SA_B = "8e100000-0000-4000-8000-000000000002";
const MGR = "8e100000-0000-4000-8000-000000000003";
const X = "8e100000-0000-4000-8000-000000000004";
const Y = "8e100000-0000-4000-8000-000000000005";
const WS = "9e100000-0000-4000-8000-000000000001";
const TASK = "9e100000-0000-4000-8000-000000000002";
const FIXTURE_IDS = [SA_A, SA_B, MGR, X, Y];
const quoted = (ids) => ids.map((id) => `'${id}'`).join(", ");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sql(text) {
  const r = spawnSync("docker", PSQL, { input: text, encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || `psql exited with ${r.status}`).trim());
  return r.stdout.trim();
}
const rows = (text) => sql(text).split(/\r?\n/).filter(Boolean);

let failed = false;
const check = (cond, label) => {
  console.log(`${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) failed = true;
  return cond;
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
const running = new Set();

/** One transaction in its own psql session; resolves with its outcome and timing. */
function session(name, body) {
  const startedAt = Date.now();
  const p = spawn("docker", PSQL);
  running.add(p);
  p.stdin.on("error", () => {}); // the session may already have ended
  let stderr = "";
  p.stderr.on("data", (d) => (stderr += d));
  p.stdout.resume();
  const done = new Promise((resolve) =>
    p.on("close", (code) => {
      running.delete(p);
      resolve({ name, ok: code === 0, error: stderr.trim(), startedAt, endedAt: Date.now() });
    }),
  );
  p.stdin.end(`set application_name = '${name}';\nset lock_timeout = '${WAIT_MS * 2}ms';\n${body}\n`);
  return done;
}

/** The gate: a session holding the advisory lock until release() is called. */
function openGate(name) {
  const p = spawn("docker", PSQL);
  running.add(p);
  p.stdin.on("error", () => {}); // the session may already have ended
  p.stdout.resume();
  p.stderr.resume();
  const closed = new Promise((resolve) => p.on("close", () => (running.delete(p), resolve())));
  p.stdin.write(`set application_name = '${name}';\nselect pg_advisory_lock(${GATE_KEY});\n`);
  let released = false;
  return {
    async release() {
      if (released) return closed;
      released = true;
      p.stdin.end(`select pg_advisory_unlock(${GATE_KEY});\n\\q\n`);
      return closed;
    },
  };
}

/** Polls a condition (a SQL query returning one row) until it holds or the timeout passes. */
async function waitFor(query, accept) {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const out = sql(query);
    if (out && accept(out)) return out;
    await pause(150);
  }
  return null;
}

const pidOf = (name) => `(select pid from pg_stat_activity where application_name = '${name}' limit 1)`;

/**
 * Holder runs `holderSql` then waits on the gate; waiter runs `waiterSql`.
 * Returns both outcomes plus the observed lock evidence (or null).
 */
async function race(label, holderSql, waiterSql) {
  const names = { gate: `race-gate-${label}-${RUN}`, holder: `race-holder-${label}-${RUN}`, waiter: `race-waiter-${label}-${RUN}` };
  const gate = openGate(names.gate);
  const evidence = {};
  let holder, waiter;
  try {
    const gateHeld = await waitFor(
      `select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
       where a.application_name = '${names.gate}' and l.locktype = 'advisory' and l.granted and l.objid = ${GATE_KEY}`,
      (out) => out === "1",
    );
    if (check(Boolean(gateHeld), `${label}: gate lock held`)) {
      holder = session(names.holder, `begin;\n${holderSql}\nselect pg_advisory_xact_lock(${GATE_KEY});\ncommit;`);
      // The holder is past its protected change once it waits on the gate.
      evidence.holderAtGate = await waitFor(
        `select a.pid || '|' || a.wait_event_type || '|' || a.wait_event from pg_stat_activity a
         where a.application_name = '${names.holder}' and a.wait_event_type = 'Lock'
           and ${pidOf(names.gate)} = any (pg_blocking_pids(a.pid))`,
        (out) => out.split("|").length === 3,
      );
    }
    if (holder && check(Boolean(evidence.holderAtGate), `${label}: holder made its change and is holding its locks`)) {
      waiter = session(names.waiter, `begin;\n${waiterSql}\ncommit;`);
      evidence.waiterBlocked = await waitFor(
        `select a.pid || '|' || a.wait_event_type || '|' || a.wait_event || '|' || array_to_string(pg_blocking_pids(a.pid), ',')
         from pg_stat_activity a
         where a.application_name = '${names.waiter}' and a.wait_event_type = 'Lock'
           and ${pidOf(names.holder)} = any (pg_blocking_pids(a.pid))`,
        (out) => out.split("|").length === 4,
      );
      check(Boolean(evidence.waiterBlocked), `${label}: the waiter was blocked by the holder (genuine lock contention)`);
    }
  } finally {
    await gate.release();
  }
  // Always wait for whatever was started, so nothing runs on in the background.
  const [h, w] = await Promise.all([holder, waiter]);
  for (const r of [h, w].filter(Boolean)) {
    const reason = r.ok ? "" : ` (${r.error.split("\n").find((l) => l.includes("ERROR")) ?? r.error})`;
    console.log(`   ${r.name}: ${r.ok ? "committed" : "refused"} after ${r.endedAt - r.startedAt} ms${reason}`);
  }
  if (evidence.waiterBlocked) {
    const [, type, event] = evidence.waiterBlocked.split("|");
    console.log(`   evidence: waiter waited on ${type}/${event}, blocked by the holder's backend`);
  }
  // Results are only judged when contention was actually observed.
  return { holder: h, waiter: w, evidence: evidence.waiterBlocked ? evidence : null };
}

// ---------------------------------------------------------------------------
// Restore and cleanup (also used by the signal handlers)
// ---------------------------------------------------------------------------
let captured = []; // super admin profile ids deactivated for race 1
let fixturesCreated = false;
let finished = false;

function recoverySql(ids) {
  return `update public.profiles set is_active = true where id in (${quoted(ids)});`;
}

function restoreSuperAdmins() {
  if (!captured.length) return true;
  try {
    sql(recoverySql(captured));
  } catch (e) {
    console.error(`Could not reactivate the captured super admins: ${e.message}`);
  }
  let active = -1;
  try {
    active = Number(sql(`select count(*) from public.profiles where id in (${quoted(captured)}) and role = 'SUPER_ADMIN' and is_active`));
  } catch (e) {
    console.error(`Could not verify the captured super admins: ${e.message}`);
  }
  const ok = check(active === captured.length, `the ${captured.length} captured super admin profile(s) are active again`);
  if (ok) {
    if (existsSync(RECOVERY_FILE)) unlinkSync(RECOVERY_FILE);
  } else {
    console.error(`\nRECOVERY NEEDED. The recovery file was kept: ${RECOVERY_FILE}`);
    console.error(`Run this against the LOCAL database (Supabase Studio SQL editor, or docker exec -i ${CONTAINER} psql -U postgres -d postgres):`);
    console.error(`  ${recoverySql(captured)}`);
  }
  return ok;
}

function cleanupFixtures() {
  if (!fixturesCreated) return;
  try {
    sql(`begin;
delete from public.workspaces where id = '${WS}';
delete from auth.users where id in (${quoted(FIXTURE_IDS)}) and email like '%@race.test';
commit;`);
  } catch (e) {
    console.error(`Fixture cleanup failed: ${e.message}`);
  }
  let left = [];
  try {
    left = rows(`select 'workspace ' || id from public.workspaces where id = '${WS}'
                 union all select 'account ' || id || ' ' || email from auth.users where id in (${quoted(FIXTURE_IDS)})`);
  } catch (e) {
    left = [`(could not check: ${e.message})`];
  }
  if (!check(left.length === 0, "all fixtures of this run removed")) {
    console.error("Remaining fixtures:\n  " + left.join("\n  "));
    console.error(`To remove them (local only, after the super admins above are active again):
  begin; delete from public.workspaces where id = '${WS}';
  delete from auth.users where id in (${quoted(FIXTURE_IDS)}) and email like '%@race.test'; commit;`);
  }
}

function terminateOwnSessions() {
  for (const p of running) p.kill();
  try {
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name like 'race-%-${RUN}'`);
  } catch {
    // best effort
  }
}

/** Runs once: stop our sessions, restore the captured super admins, then remove fixtures. */
function finish() {
  if (finished) return;
  finished = true;
  terminateOwnSessions();
  // Fixture super admins are only deleted once the captured ones are verified active.
  if (restoreSuperAdmins()) cleanupFixtures();
  else console.error("Fixtures were NOT removed because the super admin restore could not be verified.");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.error(`\nReceived ${signal}: restoring and cleaning up (best effort)...`);
    failed = true;
    finish();
    process.exit(130);
  });
}

// ---------------------------------------------------------------------------
// Pre-flight checks (no writes)
// ---------------------------------------------------------------------------
function preflight() {
  const state = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER], { encoding: "utf8" });
  if (state.status !== 0 || state.stdout.trim() !== "true") {
    throw new Error(`Container ${CONTAINER} is not running (start the local stack with "npx supabase start").`);
  }
  const stale = readdirSync(tmpdir()).filter((f) => f.startsWith(RECOVERY_PREFIX));
  if (stale.length) {
    throw new Error(`A recovery file from an earlier run exists; resolve it first:\n  ${stale.map((f) => path.join(tmpdir(), f)).join("\n  ")}`);
  }
  const leftovers = rows(`select 'account ' || id || ' ' || email from auth.users where id in (${quoted(FIXTURE_IDS)}) or email like '%@race.test'
                          union all select 'workspace ' || id from public.workspaces where id = '${WS}'
                          union all select 'task ' || id from public.tasks where id = '${TASK}'`);
  if (leftovers.length) {
    throw new Error(`Fixtures from an earlier run exist; nothing was changed. Remove them deliberately first:\n  ${leftovers.join("\n  ")}`);
  }
  const activeSuperAdmins = Number(sql(`select count(*) from public.profiles where role = 'SUPER_ADMIN' and is_active`));
  if (activeSuperAdmins < 1) {
    throw new Error("No active super admin exists locally (an earlier run may have been interrupted). Reactivate it before running.");
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------
try {
  preflight();

  sql(`begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('${SA_A}', 'race-a@race.test', '{"full_name":"Race A"}'),
  ('${SA_B}', 'race-b@race.test', '{"full_name":"Race B"}'),
  ('${MGR}', 'race-mgr@race.test', '{"full_name":"Race Manager"}'),
  ('${X}', 'race-x@race.test', '{"full_name":"Race X"}'),
  ('${Y}', 'race-y@race.test', '{"full_name":"Race Y"}');
update public.profiles set role = 'SUPER_ADMIN' where id in ('${SA_A}', '${SA_B}');
update public.profiles set role = 'ADMIN' where id = '${MGR}';
insert into public.workspaces (id, name, created_by) values ('${WS}', 'Race workspace', '${MGR}');
insert into public.workspace_members (workspace_id, user_id) values ('${WS}', '${X}'), ('${WS}', '${Y}');
insert into public.tasks (id, project_id, title, created_by)
  values ('${TASK}', (select id from public.projects where workspace_id = '${WS}' and is_default), 'Race task', '${MGR}');
insert into public.task_assignees (task_id, user_id, assigned_by, is_primary) values
  ('${TASK}', '${X}', '${MGR}', true), ('${TASK}', '${Y}', '${MGR}', false);
commit;`);
  fixturesCreated = true;

  // ---- Race 1: the last two active super admins demote each other ----------
  const toCapture = rows(`select id from public.profiles where role = 'SUPER_ADMIN' and is_active and id not in ('${SA_A}', '${SA_B}')`);
  if (!toCapture.every((id) => UUID.test(id))) throw new Error(`Unexpected profile ids: ${toCapture.join(", ")}`);
  if (toCapture.length) {
    // Written before anything is deactivated: ids and SQL only, no personal data or secrets.
    writeFileSync(
      RECOVERY_FILE,
      JSON.stringify({ run: RUN, createdAt: new Date().toISOString(), container: CONTAINER, profileIds: toCapture, recoverySql: recoverySql(toCapture) }, null, 2),
    );
    console.log(`Recovery file written: ${RECOVERY_FILE}`);
    captured = toCapture;
    sql(`update public.profiles set is_active = false where id in (${quoted(captured)});`);
  }
  const r1 = await race(
    "sa",
    `update public.profiles set role = 'ADMIN' where id = '${SA_B}';`,
    `update public.profiles set role = 'ADMIN' where id = '${SA_A}';`,
  );
  if (r1.evidence) {
    check(r1.holder?.ok === true, "race 1: the first demotion committed");
    check(r1.waiter?.ok === false && r1.waiter.error.includes("At least one active super admin must remain"),
      "race 1: the concurrent demotion was refused by the last-super-admin guard");
    const activeFixtures = Number(sql(`select count(*) from public.profiles where id in ('${SA_A}', '${SA_B}') and role = 'SUPER_ADMIN' and is_active`));
    check(activeFixtures === 1, "race 1: one active super admin remains");
  }
  // Reactivate the captured super admins as soon as race 1 is over.
  if (!restoreSuperAdmins()) throw new Error("Stopping: the captured super admins could not be verified active.");
  captured = [];

  // ---- Race 2: two managers remove the last two assignees -----------------
  const asManager = `set local role authenticated;\nset local request.jwt.claims to '{"sub":"${MGR}","role":"authenticated"}';`;
  const r2 = await race(
    "assign",
    `${asManager}\ndelete from public.task_assignees where task_id = '${TASK}' and user_id = '${X}';`,
    `${asManager}\ndelete from public.task_assignees where task_id = '${TASK}' and user_id = '${Y}';`,
  );
  if (r2.evidence) {
    check(r2.holder?.ok === true, "race 2: the first removal committed");
    check(r2.waiter?.ok === false && r2.waiter.error.includes("Assign at least one person"),
      "race 2: the concurrent removal was refused (the task kept an assignee)");
    const [left, primaries] = sql(`select count(*), count(*) filter (where is_primary) from public.task_assignees where task_id = '${TASK}'`)
      .split("|")
      .map(Number);
    check(left === 1 && primaries === 1, "race 2: one assignee remains and is the primary");
  }
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  finish();
}

process.exit(failed ? 1 : 0);
