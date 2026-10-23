// Progress rules shared by tasks, projects, clients and dashboards (pure, unit-tested).
//
//  * A leaf task is a task with no (non-cancelled) subtasks. Counts of work —
//    project, client and company totals — count leaf tasks only, so a parent
//    and its subtasks are never counted twice.
//  * A task with subtasks shows progress derived from them (done / total);
//    only leaf tasks use their own manual progress.

export function percent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

type ProgressTask = { status: string; progress: number; subtaskTotal?: number; subtaskDone?: number };

/** True when the task's progress comes from its subtasks rather than the manual value. */
export function hasDerivedProgress(t: Pick<ProgressTask, "subtaskTotal">): boolean {
  return (t.subtaskTotal ?? 0) > 0;
}

/** Effective progress (0-100): from subtasks when the task has any, else its own (100 once completed). */
export function taskProgress(t: ProgressTask): number {
  if (hasDerivedProgress(t)) return percent(t.subtaskDone ?? 0, t.subtaskTotal ?? 0);
  if (t.status === "COMPLETED") return 100;
  return Math.min(100, Math.max(0, Math.round(t.progress)));
}

/** True for tasks without subtasks (by their direct-subtask count). */
export function isLeafTask(t: Pick<ProgressTask, "subtaskTotal">): boolean {
  return !hasDerivedProgress(t);
}

export type LeafCount = { total: number; completed: number };

/**
 * Leaf-task totals per group (e.g. per project) from a flat list of tasks that
 * already excludes cancelled ones. A task is a leaf when no task in the list
 * names it as its parent.
 */
export function countLeafTasks<T extends { id: string; parentTaskId: string | null; status: string }>(
  tasks: readonly T[],
  groupOf: (t: T) => string,
): Map<string, LeafCount> {
  const parents = new Set(tasks.map((t) => t.parentTaskId).filter((id): id is string => Boolean(id)));
  const counts = new Map<string, LeafCount>();
  for (const t of tasks) {
    if (parents.has(t.id)) continue;
    const key = groupOf(t);
    const c = counts.get(key) ?? { total: 0, completed: 0 };
    c.total += 1;
    if (t.status === "COMPLETED") c.completed += 1;
    counts.set(key, c);
  }
  return counts;
}

/** Adds up leaf counts from disjoint groups (e.g. a client's projects). */
export function combineProgress(parts: readonly LeafCount[]): LeafCount & { progress: number } {
  const total = parts.reduce((n, p) => n + p.total, 0);
  const completed = parts.reduce((n, p) => n + p.completed, 0);
  return { total, completed, progress: percent(completed, total) };
}
