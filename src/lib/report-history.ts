// Pure rules for showing historical daily reports (no I/O, unit-tested).

import { addMonths, monthRange, parseMonth } from "./attendance.ts";
import type { UserRole } from "./auth/roles.ts";

export type RosterMember = {
  userId: string;
  isActive: boolean;
  managerId: string | null;
  team: string | null;
};

export type Viewer = { userId: string; role: UserRole; team: string | null };

/** active: current member; inactive: deactivated member; removed: no longer in the workspace. */
export type RosterState = "active" | "inactive" | "removed";
export type RosterEntry<M> = { userId: string; member: M | null; state: RosterState };

/**
 * Who appears in the team reports view for one date. Active members in the
 * viewer's scope always appear (so missing submissions show up). Deactivated
 * members and people no longer in the workspace appear only when they have a
 * report for that date, so their history is not hidden. Admins keep their
 * existing scope (self, direct reports, own department); people removed from
 * the workspace have no profile to scope by, so only super admins see them.
 * Which report rows exist at all is still decided by RLS.
 */
export function buildReportRoster<M extends RosterMember>(
  members: readonly M[],
  reportUserIds: Iterable<string>,
  viewer: Viewer,
): RosterEntry<M>[] {
  const withReport = new Set(reportUserIds);
  const isSuperAdmin = viewer.role === "SUPER_ADMIN";
  const inScope = (m: M) =>
    isSuperAdmin ||
    m.userId === viewer.userId ||
    m.managerId === viewer.userId ||
    (viewer.team !== null && m.team === viewer.team);

  const entries: RosterEntry<M>[] = [];
  const known = new Set<string>();
  for (const m of members) {
    known.add(m.userId);
    if (!inScope(m)) continue;
    if (m.isActive) entries.push({ userId: m.userId, member: m, state: "active" });
    else if (withReport.has(m.userId)) entries.push({ userId: m.userId, member: m, state: "inactive" });
  }
  if (isSuperAdmin) {
    for (const id of withReport) if (!known.has(id)) entries.push({ userId: id, member: null, state: "removed" });
  }
  return entries;
}

/**
 * Submission time to store on (re)submission: the first submission is kept;
 * only a report that was never submitted gets the current time.
 */
export function firstSubmissionTime(existing: string | null | undefined, now: string): string {
  return existing ?? now;
}

/**
 * Label for a task id stored in a report. A super admin can read every task in
 * the workspace (RLS), so an id they cannot resolve no longer exists. For
 * anyone else it may simply be outside what they are allowed to see.
 */
export function reportTaskLabel(id: string, titles: ReadonlyMap<string, string>, viewerSeesAllTasks: boolean): string {
  return titles.get(id) ?? (viewerSeesAllTasks ? "(deleted task)" : "(task)");
}

/** True when the row was saved again after its latest first-submission time (beyond clock noise). */
export function updatedAfterSubmission(updatedAt: string | null | undefined, ...submittedAt: (string | null | undefined)[]): boolean {
  if (!updatedAt) return false;
  const latest = Math.max(...submittedAt.map((s) => (s ? Date.parse(s) : 0)));
  return latest > 0 && Date.parse(updatedAt) - latest > 1000;
}

export type SnapshotTask = { id: string; title: string; status: string; completedAt: string | null };
export type EveningSnapshot = { capturedAt: string | null; reporterTeam: string | null; tasks: SnapshotTask[] };

/**
 * Reads daily_reports.evening_snapshot (built by public.submit_evening_report).
 * Returns null for reports without a snapshot (submitted before migration 009)
 * or with an unrecognised shape, so callers fall back to the live task lookup.
 */
export function readEveningSnapshot(value: unknown): EveningSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.tasks)) return null;
  const tasks: SnapshotTask[] = [];
  for (const t of v.tasks) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.status !== "string") continue;
    tasks.push({ id: r.id, title: r.title, status: r.status, completedAt: typeof r.completed_at === "string" ? r.completed_at : null });
  }
  return {
    capturedAt: typeof v.captured_at === "string" ? v.captured_at : null,
    reporterTeam: typeof v.reporter_team === "string" ? v.reporter_team : null,
    tasks,
  };
}

/**
 * Month shown in a person's own report history: a valid "YYYY-MM" no later
 * than the current month, otherwise the current month (future months have no
 * reports, and an invalid value must not break the page).
 */
export function historyMonth(value: unknown, today: string): string {
  const month = parseMonth(value, today);
  return month > today.slice(0, 7) ? today.slice(0, 7) : month;
}

/** Previous and next month links for the history view; no next month after the current one. */
export function historyNavigation(month: string, today: string): { previous: string; next: string | null } {
  const next = addMonths(month, 1);
  return { previous: addMonths(month, -1), next: next > today.slice(0, 7) ? null : next };
}

/** First and last day of a history month, never past today. */
export function historyRange(month: string, today: string): { first: string; last: string } {
  const { first, last } = monthRange(month);
  return { first, last: last > today ? today : last };
}

export type HistoryReportRow = {
  id: string;
  report_date: string;
  total_hours: number;
  tasks_completed: number;
  tasks_in_progress: number;
  tasks_blocked: number;
  morning_plan: string | null;
  planned_task_ids: string[] | null;
  accomplishments: string | null;
  work_remaining: string | null;
  blockers: string | null;
  tomorrow_plan: string | null;
  linked_task_ids: string[] | null;
  morning_submitted_at: string | null;
  evening_submitted_at: string | null;
  updated_at: string;
  evening_snapshot: unknown;
};

export type HistoryEntry = {
  id: string;
  date: string;
  totalHours: number;
  morningSubmittedAt: string | null;
  eveningSubmittedAt: string | null;
  /** Saved again after its latest first submission; the latest content is shown. */
  updatedAt: string | null;
  /** Counts stored with the evening report; null until it is submitted. */
  counts: { completed: number; notCompleted: number; blocked: number } | null;
  /** True when the tasks come from the evening snapshot (migration 009). */
  fromSnapshot: boolean;
  /** Labelled sections with text, in display order; empty ones are left out. */
  sections: { label: string; text: string }[];
};

/**
 * One day of a person's own history. Evening reports submitted through
 * submit_evening_report (009) list their tasks as they were then; older
 * reports have no snapshot and fall back to the linked task ids, labelled by
 * `taskLabel` (current titles, or a placeholder for tasks no longer visible).
 */
export function buildHistoryEntry(row: HistoryReportRow, taskLabel: (id: string) => string, statusLabel: (status: string) => string): HistoryEntry {
  const snapshot = readEveningSnapshot(row.evening_snapshot);
  const planned = row.planned_task_ids?.length ? row.planned_task_ids.map(taskLabel).join(", ") : null;
  const covered = snapshot
    ? snapshot.tasks.map((t) => `${t.title} (${statusLabel(t.status)})`).join(", ") || null
    : row.linked_task_ids?.length
      ? row.linked_task_ids.map(taskLabel).join(", ")
      : null;
  const sections = (
    [
      ["Planned tasks", planned],
      ["Plan notes", row.morning_plan],
      ["Accomplishments", row.accomplishments],
      ["Why incomplete", row.work_remaining],
      ["Blockers", row.blockers],
      ["Tomorrow's priorities", row.tomorrow_plan],
      [snapshot ? "Tasks covered (as submitted)" : "Tasks covered", covered],
    ] satisfies [string, string | null][]
  ).flatMap(([label, text]) => (text?.trim() ? [{ label, text }] : []));
  return {
    id: row.id,
    date: row.report_date,
    totalHours: Number(row.total_hours) || 0,
    morningSubmittedAt: row.morning_submitted_at,
    eveningSubmittedAt: row.evening_submitted_at,
    updatedAt: updatedAfterSubmission(row.updated_at, row.morning_submitted_at, row.evening_submitted_at) ? row.updated_at : null,
    counts: row.evening_submitted_at
      ? { completed: row.tasks_completed, notCompleted: row.tasks_in_progress, blocked: row.tasks_blocked }
      : null,
    fromSnapshot: snapshot !== null,
    sections,
  };
}

/** "7h 30m" for the hours stored with a report. */
export function formatReportHours(n: number): string {
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
