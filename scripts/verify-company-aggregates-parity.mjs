// Direct parity check for migration 053: one fixture, expressed once as plain
// row-level data, feeds BOTH systems --
//   (a) the real pure JS functions in src/lib/super-admin-overview.ts
//       (statusCounts / employeePerformance / departmentProgress / projectProgress),
//   (b) the real company_*_task_counts SQL RPCs, called against the LOCAL
//       database, merged through the *FromCounts functions in the same file
// -- and asserts the two outputs are deepStrictEqual. This is independent of
// (and does not replace) company_aggregates.test.sql's pgTAP assertions and
// super-admin-overview.test.ts's unit tests, which both compare against
// separately-derived expected values rather than against each other.
//
// The fixture is deliberately NOT a copy of super-admin-overview.test.ts's
// "parent task" fixture: that test sets `subtaskTotal: 2` directly on a
// synthetic OverviewTask with no corresponding child rows (fine for testing
// the pure function in isolation, but not representable as real database
// rows without inventing extra tasks that would silently change the
// company-wide totals). Here, subtaskTotal is instead *computed* from a real
// parent/child task pair in the same row list that gets inserted -- the one
// JS object array below is the single source of truth for both systems.
//
// Names are chosen so Postgres's default collation and JS's localeCompare
// would visibly disagree on project assignee ordering if the merge function
// didn't re-sort them in JS (see projectProgressFromCounts): "Zeel" (capital)
// vs "amy@parity.test" (lowercase) sort oppositely under ASCII/C collation
// vs locale-aware comparison.
//
// Safety: connects only through `docker exec -i supabase_db_taskmanagement
// psql` (never a URL or linked project), refuses to run if a leftover
// fixture from an interrupted prior run exists, and always attempts cleanup
// (a committed transaction, not a rollback -- this is real fixture data,
// deleted explicitly at the end).
//
// Usage: node scripts/verify-company-aggregates-parity.mjs

import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  departmentProgress,
  departmentProgressFromCounts,
  employeePerformance,
  employeePerformanceFromCounts,
  inDateRange,
  projectProgress,
  projectProgressFromCounts,
  statusCounts,
} from "../src/lib/super-admin-overview.ts";

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

function sql(text) {
  const r = spawnSync("docker", PSQL, { input: text, encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || `psql exited with ${r.status}`).trim());
  return r.stdout;
}
const lines = (text) => sql(text).split("\n").filter((l) => l.length > 0);
const cell = (v) => (v === "" ? null : v);
const pgArray = (v) => (v === "{}" || v === "" ? [] : v.slice(1, -1).split(","));

let failed = false;
function check(cond, label) {
  console.log(`${cond ? "ok" : "FAIL"} - ${label}`);
  if (!cond) failed = true;
  return cond;
}
function checkEqual(actual, expected, label) {
  try {
    assert.deepStrictEqual(actual, expected);
    check(true, label);
  } catch {
    check(false, label);
    console.error(`   JS:  ${JSON.stringify(actual)}`);
    console.error(`   SQL: ${JSON.stringify(expected)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture (single source of truth: these objects are both inserted as rows
// and fed straight to the pure JS functions below).
// ---------------------------------------------------------------------------
const TODAY = "2026-10-27";
const RANGE = { from: "2026-10-19", to: "2026-10-21" };
const TZ = "Asia/Kolkata";

const ADM = "fa000000-0000-4000-8000-000000000001";
const U1 = "fa000000-0000-4000-8000-000000000002"; // "Zeel", Design
const U2 = "fa000000-0000-4000-8000-000000000003"; // "Bala", Design
const U3 = "fa000000-0000-4000-8000-000000000004"; // no full_name -> falls back to email; no team
const OFF = "fa000000-0000-4000-8000-000000000005"; // "Nora", Design -- deactivated after assignment
const WS = "fa100000-0000-4000-8000-000000000001";
const PA = "fa200000-0000-4000-8000-000000000001";
const PB = "fa200000-0000-4000-8000-000000000002";
const T1 = "fa300000-0000-4000-8000-000000000001";
const T2 = "fa300000-0000-4000-8000-000000000002";
const T3 = "fa300000-0000-4000-8000-000000000003";
const T4 = "fa300000-0000-4000-8000-000000000004";
const PARENT = "fa300000-0000-4000-8000-000000000005";
const PARENT_CHILD = "fa300000-0000-4000-8000-000000000006";
const T5 = "fa300000-0000-4000-8000-000000000007";
const T_OFF = "fa300000-0000-4000-8000-000000000008";

const members = [
  { userId: U1, fullName: "Zeel", email: "u1@parity.test", role: "INDIVIDUAL", isActive: true, team: "Design" },
  { userId: U2, fullName: "Bala", email: "u2@parity.test", role: "ADMIN", isActive: true, team: "Design" },
  { userId: U3, fullName: null, email: "amy@parity.test", role: "INDIVIDUAL", isActive: true, team: null },
  { userId: OFF, fullName: "Nora", email: "off@parity.test", role: "INDIVIDUAL", isActive: false, team: "Design" },
];
const nameOf = new Map(members.map((m) => [m.userId, { fullName: m.fullName, email: m.email }]));

// id, projectId, status, dueDate, scheduledDate, completedAt, updatedAt, parentTaskId, assignees
const rawTasks = [
  { id: T1, projectId: PA, status: "COMPLETED", dueDate: null, scheduledDate: "2030-01-01", completedAt: "2026-10-20T06:00:00Z", updatedAt: "2026-10-20T06:00:00Z", parentTaskId: null, assignees: [U1, U2] },
  { id: T2, projectId: PA, status: "IN_PROGRESS", dueDate: null, scheduledDate: "2026-10-20", completedAt: null, updatedAt: "2026-10-21T00:00:00Z", parentTaskId: null, assignees: [U1, U3] },
  { id: T3, projectId: PA, status: "TODO", dueDate: "2026-10-25", scheduledDate: "2030-01-01", completedAt: null, updatedAt: "2026-10-22T00:00:00Z", parentTaskId: null, assignees: [U1] },
  { id: T4, projectId: PA, status: "CANCELLED", dueDate: null, scheduledDate: TODAY, completedAt: null, updatedAt: "2026-10-23T00:00:00Z", parentTaskId: null, assignees: [U1] },
  { id: PARENT, projectId: PA, status: "IN_PROGRESS", dueDate: null, scheduledDate: TODAY, completedAt: null, updatedAt: "2026-10-19T00:00:00Z", parentTaskId: null, assignees: [U1] },
  { id: PARENT_CHILD, projectId: PA, status: "TODO", dueDate: null, scheduledDate: TODAY, completedAt: null, updatedAt: "2026-10-19T00:00:00Z", parentTaskId: PARENT, assignees: [U1] },
  { id: T5, projectId: PB, status: "TODO", dueDate: null, scheduledDate: TODAY, completedAt: null, updatedAt: "2026-10-24T00:00:00Z", parentTaskId: null, assignees: [U3] },
  { id: T_OFF, projectId: PB, status: "TODO", dueDate: null, scheduledDate: TODAY, completedAt: null, updatedAt: "2026-10-18T00:00:00Z", parentTaskId: null, assignees: [OFF] },
];

/** The same leaf rule as the SQL CTEs: a non-cancelled direct child that is itself non-cancelled. */
const subtaskTotalOf = (id) => rawTasks.filter((t) => t.parentTaskId === id && t.status !== "CANCELLED").length;

const overviewTasks = rawTasks.map((t) => ({
  id: t.id,
  status: t.status,
  scheduledDate: t.scheduledDate,
  dueDate: t.dueDate,
  completedAt: t.completedAt,
  updatedAt: t.updatedAt,
  projectId: t.projectId,
  subtaskTotal: subtaskTotalOf(t.id),
  assignees: t.assignees.map((uid) => ({ userId: uid, ...nameOf.get(uid) })),
}));

const projects = [
  { id: PA, name: "Project A", clientId: null, clientName: null, ownerName: null, dueDate: null },
  { id: PB, name: "Project B", clientId: null, clientName: null, ownerName: null, dueDate: null },
];

// ---------------------------------------------------------------------------
// Preflight: refuse to run over a leftover fixture from an earlier run.
// ---------------------------------------------------------------------------
function preflight() {
  const state = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", CONTAINER], { encoding: "utf8" });
  if (state.status !== 0 || state.stdout.trim() !== "true") {
    throw new Error(`Container ${CONTAINER} is not running (start the local stack with "npx supabase start").`);
  }
  const leftovers = lines(
    `select 'account ' || id || ' ' || email from auth.users where email like '%@parity.test'
     union all select 'workspace ' || id from public.workspaces where id = '${WS}'`,
  );
  if (leftovers.length) {
    throw new Error(`Fixtures from an earlier run exist; nothing was changed. Remove them deliberately first:\n  ${leftovers.join("\n  ")}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture setup (committed, not rolled back -- cleaned up explicitly below).
// ---------------------------------------------------------------------------
function insertFixture() {
  sql(`begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('${ADM}', 'adm@parity.test', '{"full_name":"ADM"}'),
  ('${U1}', 'u1@parity.test', '{"full_name":"Zeel"}'),
  ('${U2}', 'u2@parity.test', '{"full_name":"Bala"}'),
  ('${U3}', 'amy@parity.test', '{}'),
  ('${OFF}', 'off@parity.test', '{"full_name":"Nora"}');
update public.profiles set role = 'ADMIN' where id in ('${ADM}', '${U2}');
update public.profiles set team = 'Design' where id in ('${U1}', '${U2}', '${OFF}');
insert into public.workspaces (id, name, created_by) values ('${WS}', 'Parity WS', '${ADM}');
insert into public.workspace_members (workspace_id, user_id) values
  ('${WS}', '${U1}'), ('${WS}', '${U2}'), ('${WS}', '${U3}'), ('${WS}', '${OFF}');
insert into public.projects (id, workspace_id, name, created_by) values
  ('${PA}', '${WS}', 'Project A', '${ADM}'),
  ('${PB}', '${WS}', 'Project B', '${ADM}');
-- track_task_completion forces completed_at to now() on insert; disabled for
-- T1 (COMPLETED, explicit historical completed_at). set_task_schedule_default
-- defaults scheduled_date to the real "today" when null at insert -- not
-- needed here since every row below sets an explicit scheduled_date, but
-- disabled anyway for a single, simple statement.
alter table public.tasks disable trigger track_task_completion;
alter table public.tasks disable trigger set_task_schedule_default;
insert into public.tasks (id, project_id, parent_task_id, title, status, due_date, scheduled_date, completed_at, updated_at, created_by) values
${rawTasks.map((t) => `  ('${t.id}', '${t.projectId}', ${t.parentTaskId ? `'${t.parentTaskId}'` : "null"}, 'Task ${t.id.slice(-4)}', '${t.status}', ${t.dueDate ? `'${t.dueDate}'` : "null"}, '${t.scheduledDate}', ${t.completedAt ? `'${t.completedAt}'` : "null"}, '${t.updatedAt}', '${ADM}')`).join(",\n")};
alter table public.tasks enable trigger track_task_completion;
alter table public.tasks enable trigger set_task_schedule_default;
insert into public.task_assignees (task_id, user_id, assigned_by) values
${rawTasks.flatMap((t) => t.assignees.map((uid) => `  ('${t.id}', '${uid}', '${ADM}')`)).join(",\n")};
commit;`);
  // OFF must be active while its assignment is inserted (the task_assignees
  // validity trigger requires it), then deactivated -- same as company_aggregates.test.sql.
  sql(`update public.profiles set is_active = false where id = '${OFF}';`);
}

function cleanupFixture() {
  try {
    sql(`begin;
delete from public.workspaces where id = '${WS}';
delete from auth.users where email like '%@parity.test';
commit;`);
  } catch (e) {
    console.error(`Fixture cleanup failed: ${e.message}`);
  }
  const left = lines(
    `select 'account ' || id || ' ' || email from auth.users where email like '%@parity.test'
     union all select 'workspace ' || id from public.workspaces where id = '${WS}'`,
  );
  if (!check(left.length === 0, "all fixtures of this run removed")) {
    console.error("Remaining fixtures:\n  " + left.join("\n  "));
  }
}

// ---------------------------------------------------------------------------
// SQL-side loaders (same shape as src/lib/data/super-admin-aggregates.ts,
// but via psql directly instead of the Supabase JS client).
// ---------------------------------------------------------------------------
function sqlStatusCounts(workspaceIds, today) {
  const [total, completed, inProgress, pending, blocked, overdue] = sql(
    `select total, completed, in_progress, pending, blocked, overdue
     from public.company_task_status_counts(array[${workspaceIds.map((w) => `'${w}'`).join(",")}]::uuid[], '${today}'::date)`,
  ).trim().split("|").map(Number);
  return { total, completed, inProgress, pending, blocked, overdue };
}

function sqlEmployeeCounts(workspaceIds, today, tz, range) {
  return lines(
    `select user_id, total, completed, in_progress, pending, blocked, overdue
     from public.company_employee_task_counts(array[${workspaceIds.map((w) => `'${w}'`).join(",")}]::uuid[], '${today}'::date, '${tz}',
       ${range ? `'${range.from}'::date` : "null"}, ${range ? `'${range.to}'::date` : "null"})`,
  ).map((line) => {
    const [userId, total, completed, inProgress, pending, blocked, overdue] = line.split("|");
    return { userId, total: Number(total), completed: Number(completed), inProgress: Number(inProgress), pending: Number(pending), blocked: Number(blocked), overdue: Number(overdue) };
  });
}

function sqlDepartmentCounts(workspaceIds, tz, range) {
  return lines(
    `select department, total, completed
     from public.company_department_task_counts(array[${workspaceIds.map((w) => `'${w}'`).join(",")}]::uuid[], '${tz}',
       ${range ? `'${range.from}'::date` : "null"}, ${range ? `'${range.to}'::date` : "null"})`,
  ).map((line) => {
    const [department, total, completed] = line.split("|");
    return { department, total: Number(total), completed: Number(completed) };
  });
}

function sqlProjectCounts(workspaceIds, today, tz, range) {
  return lines(
    `select project_id, total, completed, in_progress, pending, blocked, overdue, next_due, last_update, assignees
     from public.company_project_task_counts(array[${workspaceIds.map((w) => `'${w}'`).join(",")}]::uuid[], '${today}'::date, '${tz}',
       ${range ? `'${range.from}'::date` : "null"}, ${range ? `'${range.to}'::date` : "null"})`,
  ).map((line) => {
    const [projectId, total, completed, inProgress, pending, blocked, overdue, nextDue, lastUpdate, assignees] = line.split("|");
    return {
      projectId,
      total: Number(total),
      completed: Number(completed),
      inProgress: Number(inProgress),
      pending: Number(pending),
      blocked: Number(blocked),
      overdue: Number(overdue),
      nextDue: cell(nextDue),
      lastUpdate: cell(lastUpdate) ? new Date(lastUpdate).toISOString() : null,
      assignees: pgArray(assignees),
    };
  });
}

// ---------------------------------------------------------------------------
// The parity check itself: same inputs into the real JS functions and into
// the real RPCs (merged via the *FromCounts functions), compared directly.
// ---------------------------------------------------------------------------
function normalizeJsProjectProgress(rows) {
  // lastUpdate/updatedAt round-trips through Postgres as an ISO string with a
  // numeric offset ("+00:00") rather than "Z"; normalise both sides to the
  // same instant representation before comparing.
  return rows.map((r) => ({ ...r, lastUpdate: r.lastUpdate ? new Date(r.lastUpdate).toISOString() : null }));
}

function run() {
  preflight();
  insertFixture();

  try {
    const workspaceIds = [WS];

    // --- all time -----------------------------------------------------------
    checkEqual(sqlStatusCounts(workspaceIds, TODAY), statusCounts(overviewTasks, TODAY), "company_task_status_counts matches statusCounts (all time)");

    const jsEmployees = employeePerformanceFromCounts(
      // Re-derive the sparse RPC-shaped input from the *JS* result is not the
      // point here -- feed the real SQL rows straight into the merge
      // function, and compare its output to the real pure function's output.
      sqlEmployeeCounts(workspaceIds, TODAY, TZ, null),
      members,
    );
    checkEqual(jsEmployees, employeePerformance(overviewTasks, members, TODAY, null, TZ), "company_employee_task_counts -> employeePerformanceFromCounts matches employeePerformance (all time)");

    const sqlDepartments = departmentProgressFromCounts(sqlDepartmentCounts(workspaceIds, TZ, null), members);
    checkEqual(sqlDepartments, departmentProgress(overviewTasks, members, null, TZ), "company_department_task_counts -> departmentProgressFromCounts matches departmentProgress (all time)");

    const sqlProjects = normalizeJsProjectProgress(projectProgressFromCounts(sqlProjectCounts(workspaceIds, TODAY, TZ, null), projects));
    const jsProjects = normalizeJsProjectProgress(projectProgress(projects, overviewTasks, TODAY));
    checkEqual(sqlProjects, jsProjects, "company_project_task_counts -> projectProgressFromCounts matches projectProgress (all time, including assignee order and the cancelled-task lastUpdate)");

    // --- date range -----------------------------------------------------------
    checkEqual(
      employeePerformanceFromCounts(sqlEmployeeCounts(workspaceIds, TODAY, TZ, RANGE), members),
      employeePerformance(overviewTasks, members, TODAY, RANGE, TZ),
      "company_employee_task_counts -> employeePerformanceFromCounts matches employeePerformance (date range)",
    );
    checkEqual(
      departmentProgressFromCounts(sqlDepartmentCounts(workspaceIds, TZ, RANGE), members),
      departmentProgress(overviewTasks, members, RANGE, TZ),
      "company_department_task_counts -> departmentProgressFromCounts matches departmentProgress (date range)",
    );
    const rangedOverviewTasks = overviewTasks.filter((t) => inDateRange(t, RANGE, TZ));
    checkEqual(
      normalizeJsProjectProgress(projectProgressFromCounts(sqlProjectCounts(workspaceIds, TODAY, TZ, RANGE), projects)),
      normalizeJsProjectProgress(projectProgress(projects, rangedOverviewTasks, TODAY)),
      "company_project_task_counts -> projectProgressFromCounts matches projectProgress (date range)",
    );
  } finally {
    cleanupFixture();
  }
}

try {
  run();
} catch (e) {
  failed = true;
  console.error(e.message);
}
process.exit(failed ? 1 : 0);
