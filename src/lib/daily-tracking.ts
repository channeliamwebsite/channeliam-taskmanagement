// Per-employee summary of public.daily_tracking() rows (pure, unit-tested).

/**
 * How a task relates to the person's morning report (public.daily_tracking):
 * MORNING in the report; CURRENT no report yet; COMPLETED_EARLY completed
 * before the report was generated; ADDED created after it; ASSIGNED assigned
 * to them after it; MOVED_IN an existing task of theirs that joined today's
 * list after it; REASSIGNED / CHANGED / REMOVED in the report but no longer
 * theirs / no longer due today / deleted.
 */
export type Tracking =
  | "MORNING"
  | "CURRENT"
  | "COMPLETED_EARLY"
  | "ADDED"
  | "ASSIGNED"
  | "MOVED_IN"
  | "REASSIGNED"
  | "CHANGED"
  | "REMOVED";

const TODAYS_WORK: ReadonlySet<Tracking> = new Set(["MORNING", "CURRENT", "COMPLETED_EARLY", "ADDED", "ASSIGNED", "MOVED_IN"]);
const ADDED_AFTER_REPORT: ReadonlySet<Tracking> = new Set(["ADDED", "ASSIGNED", "MOVED_IN"]);

export type TrackingRow = {
  userId: string;
  taskId: string;
  title: string;
  /** Current task status; null when the task no longer exists. */
  status: string | null;
  priority: string | null;
  projectName: string | null;
  clientName: string | null;
  dueDate: string | null;
  assignedAt: string | null;
  /** Status in the morning report, when the task was in it. */
  morningStatus: string | null;
  tracking: Tracking;
  morningGeneratedAt: string | null;
  eveningSubmittedAt: string | null;
};

/** Today's report timestamps per person (daily_reports), including people with no tasks. */
export type ReportTimes = {
  userId: string;
  morningGeneratedAt: string | null;
  /** The employee's own morning plan (not the automatic snapshot). */
  morningSubmittedAt?: string | null;
  eveningSubmittedAt: string | null;
  /** From the evening report. */
  blockers?: string | null;
  workRemaining?: string | null;
};

export type EmployeeTracking = {
  userId: string;
  /** Tasks in the automatic morning report. */
  morning: number;
  /** Today's open-or-done tasks that joined after the morning report (created, assigned or moved in). */
  added: number;
  completed: number;
  inProgress: number;
  /** Not started or blocked. */
  pending: number;
  /** Morning tasks that left today's list (reassigned, rescheduled/cancelled, deleted). */
  movedOut: number;
  /** completed / today's tasks, 0-100. */
  progress: number;
  morningGeneratedAt: string | null;
  /** The employee submitted a morning plan (an automatic snapshot is not a submission). */
  morningSubmittedAt: string | null;
  eveningSubmittedAt: string | null;
  rows: TrackingRow[];
};

/** True for rows that are part of the person's work today (and so counted). */
export function isTodaysWork(r: Pick<TrackingRow, "tracking">): boolean {
  return TODAYS_WORK.has(r.tracking);
}

export function summarizeTracking(
  userIds: readonly string[],
  rows: readonly TrackingRow[],
  reports: readonly ReportTimes[] = [],
): EmployeeTracking[] {
  return userIds.map((userId) => {
    const mine = rows.filter((r) => r.userId === userId);
    // An empty morning report has no task rows, so its timestamps come from the report itself.
    const report = reports.find((r) => r.userId === userId);
    const today = mine.filter(isTodaysWork);
    const completed = today.filter((r) => r.status === "COMPLETED").length;
    const inProgress = today.filter((r) => r.status === "IN_PROGRESS" || r.status === "IN_REVIEW").length;
    const pending = today.length - completed - inProgress;
    return {
      userId,
      morning: mine.filter((r) => r.morningStatus !== null).length,
      added: today.filter((r) => ADDED_AFTER_REPORT.has(r.tracking)).length,
      completed,
      inProgress,
      pending,
      movedOut: mine.length - today.length,
      progress: today.length ? Math.round((completed / today.length) * 100) : 0,
      morningGeneratedAt: report?.morningGeneratedAt ?? mine.find((r) => r.morningGeneratedAt)?.morningGeneratedAt ?? null,
      morningSubmittedAt: report?.morningSubmittedAt ?? null,
      eveningSubmittedAt: report?.eveningSubmittedAt ?? mine.find((r) => r.eveningSubmittedAt)?.eveningSubmittedAt ?? null,
      rows: [...mine].sort(
        (a, b) => Number(isTodaysWork(b)) - Number(isTodaysWork(a)) || a.title.localeCompare(b.title),
      ),
    };
  });
}

/** Short label for the tracking state shown next to a task. */
export function trackingLabel(t: Tracking): string | null {
  switch (t) {
    case "COMPLETED_EARLY":
      return "Completed before the morning report";
    case "ADDED":
      return "Created during the day";
    case "ASSIGNED":
      return "Assigned during the day";
    case "MOVED_IN":
      return "Moved into today";
    case "REASSIGNED":
      return "Reassigned";
    case "CHANGED":
      return "No longer due today";
    case "REMOVED":
      return "Deleted";
    default:
      return null;
  }
}
