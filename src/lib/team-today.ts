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
  /** True when the task has (non-cancelled) subtasks; such parents are left out of team totals. */
  hasSubtasks?: boolean;
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
  /** Morning plan / evening report submitted for today. */
  morningSubmitted: boolean;
  eveningSubmitted: boolean;
  /** Ids of the tasks behind these numbers, for the expandable row. */
  taskIds: string[];
};

export function buildTeamToday(
  employees: Employee[],
  tasks: TeamTask[],
  reports: ReadonlyMap<string, { morning: boolean; evening: boolean }>,
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
      morningSubmitted: reports.get(e.userId)?.morning ?? false,
      eveningSubmitted: reports.get(e.userId)?.evening ?? false,
      taskIds: [...ids],
    };
  });
}

/**
 * Team summary: each task counted once (unlike the employee rows, which count
 * a shared task for every assignee), and only leaf tasks — a parent with
 * subtasks is represented by its subtasks. Uses the same day rules as the rows.
 */
export function teamTotals(rows: EmployeeDay[], tasks: TeamTask[], today: string, timeZone: string) {
  const people = new Set(rows.map((r) => r.userId));
  const team = tasks.filter((t) => !t.hasSubtasks && t.assigneeIds.some((id) => people.has(id)));
  const open = team.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const pending = team.filter((t) => isInTodaysWorkload(t, today)).length;
  const completed = team.filter((t) => t.status === "COMPLETED" && isCompletedOn(t.completedAt, today, timeZone)).length;
  const planned = pending + completed;
  return {
    planned,
    completed,
    pending,
    carriedForward: open.filter((t) => isCarriedForward(t, today)).length,
    overdue: open.filter((t) => isOverdue(t.dueDate, t.status, today)).length,
    blocked: open.filter((t) => t.status === "BLOCKED").length,
    morningSubmitted: rows.filter((r) => r.morningSubmitted).length,
    eveningSubmitted: rows.filter((r) => r.eveningSubmitted).length,
    progress: planned ? Math.round((completed / planned) * 100) : 0,
  };
}
