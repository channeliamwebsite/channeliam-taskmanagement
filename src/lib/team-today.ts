// Pure "Team Today" aggregation: classifies each employee's real tasks for
// the current day using the same rules as My Day. No I/O (unit-tested).

import { isOverdue, type TaskStatus } from "./domain.ts";
import { isCarriedForward, isCompletedOn, isInTodaysWorkload } from "./scheduling.ts";

export type TeamTask = {
  id: string;
  status: TaskStatus;
  scheduledDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  assigneeIds: string[];
};

export type Employee = { userId: string; name: string };

export type EmployeeDay = Employee & {
  /** Today's workload (open + carried + due today) plus anything completed today. */
  planned: number;
  completedToday: number;
  pending: number;
  inProgress: number;
  carriedForward: number;
  overdue: number;
  blocked: number;
  /** completedToday / planned, 0–100 (0 when nothing is planned). */
  progress: number;
  reportSubmitted: boolean;
  /** Ids of the tasks behind these numbers, for the expandable row. */
  taskIds: string[];
};

export function buildTeamToday(
  employees: Employee[],
  tasks: TeamTask[],
  submittedUserIds: ReadonlySet<string>,
  today: string,
  timeZone: string,
): EmployeeDay[] {
  return employees.map((e) => {
    const mine = tasks.filter((t) => t.assigneeIds.includes(e.userId));
    const open = mine.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
    const pendingTasks = mine.filter((t) => isInTodaysWorkload(t, today));
    const completedTasks = mine.filter((t) => t.status === "COMPLETED" && isCompletedOn(t.completedAt, today, timeZone));
    const inProgress = open.filter((t) => t.status === "IN_PROGRESS");
    const carried = open.filter((t) => isCarriedForward(t, today));
    const overdue = open.filter((t) => isOverdue(t.dueDate, t.status, today));
    const blocked = open.filter((t) => t.status === "BLOCKED");
    const planned = pendingTasks.length + completedTasks.length;
    const ids = new Set([...pendingTasks, ...completedTasks, ...inProgress, ...overdue, ...blocked].map((t) => t.id));

    return {
      ...e,
      planned,
      completedToday: completedTasks.length,
      pending: pendingTasks.length,
      inProgress: inProgress.length,
      carriedForward: carried.length,
      overdue: overdue.length,
      blocked: blocked.length,
      progress: planned ? Math.round((completedTasks.length / planned) * 100) : 0,
      reportSubmitted: submittedUserIds.has(e.userId),
      taskIds: [...ids],
    };
  });
}

export function teamTotals(rows: EmployeeDay[]) {
  const sum = (k: keyof Pick<EmployeeDay, "planned" | "completedToday" | "pending" | "carriedForward" | "overdue" | "blocked">) =>
    rows.reduce((n, r) => n + r[k], 0);
  const planned = sum("planned");
  const completed = sum("completedToday");
  return {
    planned,
    completed,
    pending: sum("pending"),
    carriedForward: sum("carriedForward"),
    overdue: sum("overdue"),
    blocked: sum("blocked"),
    reportsSubmitted: rows.filter((r) => r.reportSubmitted).length,
    progress: planned ? Math.round((completed / planned) * 100) : 0,
  };
}
