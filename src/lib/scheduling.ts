// Pure scheduling / carry-forward rules shared by My Day, lists, boards and
// daily updates. No I/O, so they are unit-tested in scheduling.test.ts.

import { formatDate, isOverdue, type TaskStatus } from "./domain.ts";

type Schedulable = { scheduledDate: string | null; status: TaskStatus };

/**
 * Carry-forward is derived, never written: an unfinished task whose
 * scheduled date is before `today` belongs to today's workload. No rows are
 * moved or duplicated, so it is idempotent; the task keeps its id, original
 * scheduled date, due date, priority and assignees.
 */
export function isCarriedForward(t: Schedulable, today: string) {
  return Boolean(t.scheduledDate) && t.scheduledDate! < today && t.status !== "COMPLETED" && t.status !== "CANCELLED";
}

export type TaskFlag = { label: string; tone: "red" | "amber" | "blue" };

export function taskFlags(t: Schedulable & { dueDate: string | null }, today: string): TaskFlag[] {
  const flags: TaskFlag[] = [];
  if (isOverdue(t.dueDate, t.status, today)) flags.push({ label: "Overdue", tone: "red" });
  if (isCarriedForward(t, today)) flags.push({ label: `Carried from ${formatDate(t.scheduledDate)}`, tone: "amber" });
  return flags;
}

/** True when the task belongs to `today`'s workload (scheduled/due today or carried forward). */
export function isInTodaysWorkload(t: Schedulable & { dueDate: string | null }, today: string) {
  if (t.status === "COMPLETED" || t.status === "CANCELLED") return false;
  return isCarriedForward(t, today) || t.scheduledDate === today || (!t.scheduledDate && t.dueDate === today);
}
