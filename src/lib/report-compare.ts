// Morning plan vs. evening report for one employee and day (pure, unit-tested).
//
// Only stored data is used: the planned task ids from the morning plan, the
// evening task snapshot (task statuses as they were at evening submission,
// migration 009) and the employee's own notes. Nothing is estimated: when the
// evening report has no snapshot (submitted before 009) the comparison says so.

import type { UserRole } from "./auth/roles.ts";
import type { EveningSnapshot, RosterState } from "./report-history.ts";

/**
 * Whether someone counts as expected to report on the super admin's monitoring
 * view: active Admins and Individuals. Super admins review and do not report;
 * deactivated and former members are listed only when they submitted.
 */
export function isExpectedReporter(role: UserRole | null, state: RosterState): boolean {
  return state === "active" && (role === "ADMIN" || role === "INDIVIDUAL");
}

/** An employee submission (morning plan or evening report). An automatic morning snapshot alone is not one. */
export function hasSubmission(report: { morning_submitted_at: string | null; evening_submitted_at: string | null } | null | undefined): boolean {
  return Boolean(report?.morning_submitted_at || report?.evening_submitted_at);
}

export type Submission = "both" | "morning_only" | "evening_only" | "none";
/** Outcome of the day, known only once the evening report exists. */
export type Outcome = "completed" | "partial" | "pending" | "blocked" | "no_tasks" | "unknown";

export type ComparedTask = { id: string; title: string; status: string | null };

export type ReportInput = {
  morningSubmittedAt: string | null;
  eveningSubmittedAt: string | null;
  plannedTaskIds: readonly string[];
  snapshot: EveningSnapshot | null;
};

export type Comparison = {
  submission: Submission;
  outcome: Outcome | null;
  /** Planned tasks with their status in the evening snapshot (null: not in the evening report). */
  planned: ComparedTask[];
  plannedCompleted: number;
  /** Tasks completed in the evening report. */
  completed: ComparedTask[];
  /** Tasks still open in the evening report (not completed, not cancelled). */
  pending: ComparedTask[];
  blocked: ComparedTask[];
  /** Whether the outcome compares against the morning plan (otherwise: the evening's own tasks). */
  basedOnPlan: boolean;
};

export function compareReport(report: ReportInput | null, titleOf: (id: string) => string): Comparison {
  const am = Boolean(report?.morningSubmittedAt);
  const pm = Boolean(report?.eveningSubmittedAt);
  const submission: Submission = am && pm ? "both" : am ? "morning_only" : pm ? "evening_only" : "none";
  const snapshot = pm ? (report?.snapshot ?? null) : null;
  const statusById = new Map(snapshot?.tasks.map((t) => [t.id, t.status]) ?? []);
  const titleById = new Map(snapshot?.tasks.map((t) => [t.id, t.title]) ?? []);

  const planned: ComparedTask[] = am
    ? (report?.plannedTaskIds ?? []).map((id) => ({ id, title: titleById.get(id) ?? titleOf(id), status: statusById.get(id) ?? null }))
    : [];
  const evening = snapshot?.tasks ?? [];
  const completed = evening.filter((t) => t.status === "COMPLETED").map(({ id, title, status }) => ({ id, title, status }));
  const pending = evening
    .filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED")
    .map(({ id, title, status }) => ({ id, title, status }));
  const blocked = pending.filter((t) => t.status === "BLOCKED");

  let outcome: Outcome | null = null;
  let basedOnPlan = false;
  if (pm) {
    if (!snapshot) outcome = "unknown";
    else {
      basedOnPlan = planned.length > 0;
      const basis = basedOnPlan ? planned.map((t) => t.status) : evening.map((t) => t.status);
      const done = basis.filter((s) => s === "COMPLETED").length;
      if (basis.length === 0) outcome = "no_tasks";
      else if (done === basis.length) outcome = "completed";
      else if (basis.some((s) => s === "BLOCKED")) outcome = "blocked";
      else if (done > 0) outcome = "partial";
      else outcome = "pending";
    }
  }

  return {
    submission,
    outcome,
    planned,
    plannedCompleted: planned.filter((t) => t.status === "COMPLETED").length,
    completed,
    pending,
    blocked,
    basedOnPlan,
  };
}

export const SUBMISSION_LABELS: Record<Submission, string> = {
  both: "Both submitted",
  morning_only: "Evening report missing",
  evening_only: "Morning plan missing",
  none: "Not submitted",
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  completed: "Completed",
  partial: "Partially completed",
  pending: "Pending",
  blocked: "Blocked",
  no_tasks: "No tasks reported",
  unknown: "Submitted (no task snapshot)",
};

export type DaySummary = {
  expected: number;
  morningSubmitted: number;
  eveningSubmitted: number;
  /** Planned tasks / completed among them, for employees with both reports and a snapshot. */
  plannedTasks: number;
  plannedCompleted: number;
  /** Open tasks in submitted evening reports. */
  pendingTasks: number;
  notSubmitted: number;
};

/** Totals for the selected date over the employees expected to report. */
export function summarizeComparisons(rows: readonly { expected: boolean; comparison: Comparison }[]): DaySummary {
  const expected = rows.filter((r) => r.expected);
  const comparable = expected.filter((r) => r.comparison.submission === "both" && r.comparison.outcome !== "unknown");
  return {
    expected: expected.length,
    morningSubmitted: expected.filter((r) => r.comparison.submission === "both" || r.comparison.submission === "morning_only").length,
    eveningSubmitted: expected.filter((r) => r.comparison.submission === "both" || r.comparison.submission === "evening_only").length,
    plannedTasks: comparable.reduce((n, r) => n + r.comparison.planned.length, 0),
    plannedCompleted: comparable.reduce((n, r) => n + r.comparison.plannedCompleted, 0),
    pendingTasks: expected.reduce((n, r) => n + r.comparison.pending.length, 0),
    notSubmitted: expected.filter((r) => r.comparison.submission === "none").length,
  };
}
