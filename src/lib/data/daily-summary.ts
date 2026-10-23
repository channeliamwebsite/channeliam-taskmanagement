import "server-only";

import { isCompletedOn } from "@/lib/scheduling";

import { isCarriedForward, listTasks, type TaskSummary } from "./tasks";

export type DaySummary = {
  completed: TaskSummary[];
  notCompleted: TaskSummary[];
  blocked: TaskSummary[];
};

/**
 * A user's day derived from real task data (same rules as My Day):
 *  - completed: tasks they're assigned to that were completed today
 *  - notCompleted: today's workload (scheduled/due today or carried forward) still open
 *  - blocked: their tasks currently BLOCKED
 */
export async function summarizeDay(workspaceId: string, userId: string, today: string, timeZone: string): Promise<DaySummary> {
  // Only open tasks and tasks completed today are used below; a 48-hour window
  // covers "today" in any timezone, so older history is not loaded.
  const completedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const [openTasks, recentlyCompleted] = await Promise.all([
    listTasks({ workspaceId, assigneeId: userId, openOnly: true }),
    listTasks({ workspaceId, assigneeId: userId, status: "COMPLETED", completedAfter }),
  ]);
  const tasks = [...openTasks, ...recentlyCompleted];
  const open = (t: TaskSummary) => t.status !== "COMPLETED" && t.status !== "CANCELLED";
  return {
    completed: tasks.filter((t) => t.status === "COMPLETED" && isCompletedOn(t.completedAt, today, timeZone)),
    notCompleted: tasks.filter(
      (t) =>
        open(t) &&
        t.status !== "BLOCKED" &&
        (isCarriedForward(t, today) || t.scheduledDate === today || (!t.scheduledDate && t.dueDate === today)),
    ),
    blocked: tasks.filter((t) => t.status === "BLOCKED"),
  };
}
