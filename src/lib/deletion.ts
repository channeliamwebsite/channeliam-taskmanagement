/**
 * What a delete removes along with the record (the database cascades these;
 * see supabase/tests/database/deletions.test.sql). Shown in the confirmation
 * dialog before anything is deleted.
 */
export type DeletionImpact = {
  /** Tasks removed, the record's own task(s) and every nested subtask. */
  tasks: number;
  subtasks: number;
  comments: number;
  attachments: number;
  timeEntries: number;
  /** Dependency links to tasks that are not deleted (those tasks stay). */
  outsideDependencies: number;
};

/** The given tasks plus every nested subtask (cycle-safe). */
export function withDescendants(tasks: { id: string; parentId: string | null }[], rootIds: string[]): string[] {
  const children = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const list = children.get(t.parentId) ?? [];
    list.push(t.id);
    children.set(t.parentId, list);
  }
  const seen = new Set<string>();
  const queue = [...rootIds];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return [...seen];
}

/** Dependency links with exactly one end inside the deleted set. */
export function countOutsideDependencies(deps: { taskId: string; dependsOnTaskId: string }[], deleted: Set<string>): number {
  return deps.filter((d) => deleted.has(d.taskId) !== deleted.has(d.dependsOnTaskId)).length;
}

function plural(n: number, word: string, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

/** Plain-language lines for the confirmation dialog (only non-zero items). */
export function describeImpact(impact: DeletionImpact): string[] {
  const lines: string[] = [];
  if (impact.tasks) lines.push(plural(impact.tasks, "task") + (impact.subtasks ? ` (including ${plural(impact.subtasks, "subtask")})` : ""));
  else if (impact.subtasks) lines.push(plural(impact.subtasks, "subtask"));
  if (impact.comments) lines.push(plural(impact.comments, "comment"));
  if (impact.attachments) lines.push(plural(impact.attachments, "attachment"));
  if (impact.timeEntries) lines.push(plural(impact.timeEntries, "time entry", "time entries"));
  if (impact.outsideDependencies) {
    lines.push(`${plural(impact.outsideDependencies, "dependency link")} to other tasks (those tasks are kept)`);
  }
  return lines;
}
