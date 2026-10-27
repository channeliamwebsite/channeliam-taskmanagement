// Company-wide figures for the super admin dashboard (pure, unit-tested).
// Everything is derived from loaded rows; nothing is estimated.

import type { UserRole } from "./auth/roles.ts";
import { isOverdue, type TaskStatus } from "./domain.ts";
import { isCompletedOn, isInTodaysWorkload } from "./scheduling.ts";

export type OverviewTask = {
  id: string;
  status: TaskStatus;
  scheduledDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  updatedAt: string;
  projectId: string;
  subtaskTotal: number;
  assignees: { userId: string; fullName: string | null; email: string | null }[];
};

/** Each piece of work once: a parent with subtasks counts through them; cancelled work is excluded. */
const countable = (t: OverviewTask) => t.subtaskTotal === 0 && t.status !== "CANCELLED";

export type StatusCounts = {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  blocked: number;
  overdue: number;
};

export function statusCounts(tasks: readonly OverviewTask[], today: string): StatusCounts {
  const work = tasks.filter(countable);
  return {
    total: work.length,
    completed: work.filter((t) => t.status === "COMPLETED").length,
    inProgress: work.filter((t) => t.status === "IN_PROGRESS" || t.status === "IN_REVIEW").length,
    pending: work.filter((t) => t.status === "TODO").length,
    blocked: work.filter((t) => t.status === "BLOCKED").length,
    overdue: work.filter((t) => isOverdue(t.dueDate, t.status, today)).length,
  };
}

/** Today's work across the company: due/scheduled/carried into today, or completed today. */
export function todaysWork(tasks: readonly OverviewTask[], today: string, timeZone: string) {
  const work = tasks.filter(countable);
  const open = work.filter((t) => isInTodaysWorkload(t, today));
  const doneToday = work.filter((t) => t.status === "COMPLETED" && isCompletedOn(t.completedAt, today, timeZone));
  return { planned: open.length + doneToday.length, completedToday: doneToday.length };
}

export function employeeCounts(members: readonly { role: UserRole; isActive: boolean }[]) {
  const active = members.filter((m) => m.isActive);
  return {
    admins: active.filter((m) => m.role === "ADMIN").length,
    individuals: active.filter((m) => m.role === "INDIVIDUAL").length,
    inactive: members.filter((m) => !m.isActive && m.role !== "SUPER_ADMIN").length,
  };
}

export type ProjectInput = {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  ownerName: string | null;
  dueDate: string | null;
};

export type ProjectProgress = StatusCounts & {
  project: ProjectInput;
  /** Distinct assignees of the project's tasks. */
  assignees: string[];
  /** Earliest due date among open tasks. */
  nextDue: string | null;
  /** Most recent task change. */
  lastUpdate: string | null;
};

/** Per-project progress from the project's own tasks; projects without tasks are kept (0 of 0). */
export function projectProgress(projects: readonly ProjectInput[], tasks: readonly OverviewTask[], today: string): ProjectProgress[] {
  const byProject = new Map<string, OverviewTask[]>();
  for (const t of tasks) byProject.set(t.projectId, [...(byProject.get(t.projectId) ?? []), t]);
  return projects
    .map((project) => {
      const list = byProject.get(project.id) ?? [];
      const counts = statusCounts(list, today);
      const names = new Set<string>();
      for (const t of list.filter(countable)) for (const a of t.assignees) names.add(a.fullName || a.email || "Unknown");
      const openDue = list
        .filter((t) => countable(t) && t.status !== "COMPLETED" && t.dueDate)
        .map((t) => t.dueDate!)
        .sort();
      const updates = list.map((t) => t.updatedAt).sort();
      return {
        ...counts,
        project,
        assignees: [...names].sort((a, b) => a.localeCompare(b)),
        nextDue: openDue[0] ?? null,
        lastUpdate: updates.at(-1) ?? null,
      };
    })
    .sort(
      (a, b) =>
        (a.project.clientName ?? "~").localeCompare(b.project.clientName ?? "~") || a.project.name.localeCompare(b.project.name),
    );
}

export type MeetingInput = {
  id: string;
  title: string;
  url: string;
  team: string | null;
  kind: "MORNING" | "EVENING" | "OTHER";
  startsAt: string | null;
  meetingDate: string | null;
  isActive: boolean;
};

export type MeetingRecordInput = { meetingLinkId: string; meetingDate: string; status: string };

export type MeetingOccurrence = {
  meeting: MeetingInput;
  date: string;
  recurring: boolean;
  /** SCHEDULED / HELD / CANCELLED from a record; NOT_RECORDED for a past date without one. */
  status: "SCHEDULED" | "HELD" | "CANCELLED" | "NOT_RECORDED";
};

const KIND_ORDER = { MORNING: 0, EVENING: 1, OTHER: 2 } as const;

/**
 * Active meetings from `from` to `to` (inclusive, YYYY-MM-DD): one-off meetings
 * on their date; daily meetings once per day in the range.
 */
export function meetingOccurrences(
  meetings: readonly MeetingInput[],
  records: readonly MeetingRecordInput[],
  dates: readonly string[],
  today: string,
): MeetingOccurrence[] {
  const recorded = new Map(records.map((r) => [`${r.meetingLinkId}:${r.meetingDate}`, r.status]));
  const out: MeetingOccurrence[] = [];
  for (const m of meetings.filter((x) => x.isActive)) {
    for (const date of dates) {
      if (m.meetingDate !== null && m.meetingDate !== date) continue;
      const s = recorded.get(`${m.id}:${date}`);
      const status = s === "HELD" || s === "CANCELLED" || s === "SCHEDULED" ? s : date < today ? "NOT_RECORDED" : "SCHEDULED";
      out.push({ meeting: m, date, recurring: m.meetingDate === null, status });
    }
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER[a.meeting.kind] - KIND_ORDER[b.meeting.kind] ||
      (a.meeting.startsAt ?? "99").localeCompare(b.meeting.startsAt ?? "99") ||
      a.meeting.title.localeCompare(b.meeting.title),
  );
}

/** "09:30:00" -> "9:30 AM". */
export function formatClock(time: string | null): string | null {
  const m = time ? /^(\d{2}):(\d{2})/.exec(time) : null;
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
