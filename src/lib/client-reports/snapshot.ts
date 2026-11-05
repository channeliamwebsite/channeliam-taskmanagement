// Client report snapshots (migration 038): the frozen, team-level JSON built
// in the database at the period cutoff. Pure functions only (unit-tested).

export type ReportState = "COMPLETED" | "IN_PROGRESS" | "PENDING";

export type ClientReportSnapshot = {
  version: number;
  timezone: string;
  client: { name: string; contact_name: string | null };
  period: { start: string; end: string; frequency_days: number };
  totals: {
    total: number;
    completed: number;
    pending: number;
    in_progress: number;
    overdue: number;
    blocked: number;
    completion_percent: number;
  };
  projects: {
    project_name: string;
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
    overdue: number;
    completion_percent: number;
  }[];
  teams: { team: string; completed: number; open: number }[];
  deliverables: { title: string; project_name: string; completed_on: string }[];
  outstanding: { title: string; project_name: string; priority: string; state: ReportState; due_date: string | null; overdue: boolean }[];
  next_priorities: { title: string; project_name: string; priority: string; due_date: string | null }[];
};

/** What an export needs: the snapshot plus the admin's review notes. */
export type ClientReportDocument = {
  snapshot: ClientReportSnapshot;
  generatedAt: string | null;
  updatesNote: string | null;
  prioritiesNote: string | null;
};

export const FREQUENCY_LABELS: Record<number, string> = { 15: "Every 15 days", 30: "Every 30 days" };
export const FORMAT_LABELS = { PDF: "PDF", EXCEL: "Excel", BOTH: "PDF and Excel" } as const;
export type ReportFormat = keyof typeof FORMAT_LABELS;

const STATE_LABELS: Record<ReportState, string> = { COMPLETED: "Completed", IN_PROGRESS: "In progress", PENDING: "Pending" };
const PRIORITY_LABELS: Record<string, string> = { URGENT: "P1 Critical", HIGH: "P2 High", MEDIUM: "P3 Medium", LOW: "P4 Low" };

export function stateLabel(state: string) {
  return STATE_LABELS[state as ReportState] ?? state;
}
export function priorityLabel(priority: string) {
  return PRIORITY_LABELS[priority] ?? priority;
}

/** "1 Sep 2026" from an ISO date (no time-zone shift: the date is already India time). */
export function formatReportDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${d} ${month} ${y}`;
}

export function periodLabel(period: { start: string; end: string }) {
  return `${formatReportDate(period.start)} – ${formatReportDate(period.end)}`;
}

/**
 * Lines for "Important updates": the admin's note first, then facts from the
 * snapshot. Never empty, so a report always says something.
 */
export function importantUpdates(doc: ClientReportDocument): string[] {
  const t = doc.snapshot.totals;
  const lines = doc.updatesNote ? doc.updatesNote.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  lines.push(`${t.completed} of ${t.total} tasks completed in this period (${t.completion_percent}%).`);
  if (t.overdue) lines.push(`${t.overdue} task${t.overdue === 1 ? " is" : "s are"} past the due date.`);
  if (t.blocked) lines.push(`${t.blocked} task${t.blocked === 1 ? " is" : "s are"} blocked and need attention.`);
  return lines;
}

/** Lines for "Next-period priorities": the admin's note, then the top open items. */
export function nextPriorities(doc: ClientReportDocument): string[] {
  const lines = doc.prioritiesNote ? doc.prioritiesNote.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  for (const p of doc.snapshot.next_priorities) {
    lines.push(`${p.title} (${p.project_name}, ${priorityLabel(p.priority)}${p.due_date ? `, due ${formatReportDate(p.due_date)}` : ""})`);
  }
  if (!lines.length) lines.push("No open priorities.");
  return lines;
}

/** Safe file name part from the client name. */
export function reportFileName(doc: ClientReportDocument, ext: "pdf" | "xlsx") {
  const name = doc.snapshot.client.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "client";
  return `client-report-${name}-${doc.snapshot.period.start}-to-${doc.snapshot.period.end}.${ext}`;
}

/** Narrow check of a stored snapshot before it is rendered. */
export function isSnapshot(value: unknown): value is ClientReportSnapshot {
  const v = value as Partial<ClientReportSnapshot> | null;
  return Boolean(
    v && typeof v === "object" && v.client && v.period && v.totals &&
      Array.isArray(v.projects) && Array.isArray(v.teams) && Array.isArray(v.deliverables) &&
      Array.isArray(v.outstanding) && Array.isArray(v.next_priorities),
  );
}
