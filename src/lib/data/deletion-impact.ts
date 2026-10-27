import "server-only";

import { countOutsideDependencies, withDescendants, type DeletionImpact } from "@/lib/deletion";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// Keeps PostgREST `in (...)` filters well under URL length limits.
const CHUNK = 150;

function chunks<T>(list: T[]) {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

async function countIn(supabase: Supabase, table: "task_comments" | "task_attachments" | "time_entries", ids: string[]) {
  let total = 0;
  for (const part of chunks(ids)) {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).in("task_id", part);
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

/**
 * What deleting these tasks (and their nested subtasks) removes. Runs with the
 * caller's RLS, so counts cover what the caller can see; the database removes
 * the same rows by cascade when the delete runs.
 */
export async function taskSetImpact(
  supabase: Supabase,
  projectId: string,
  rootIds: string[] | "ALL",
): Promise<DeletionImpact> {
  const { data: tree, error } = await supabase.from("tasks").select("id, parent_task_id").eq("project_id", projectId).limit(5000);
  if (error) throw error;
  const nodes = tree.map((t) => ({ id: t.id, parentId: t.parent_task_id }));
  const roots = rootIds === "ALL" ? nodes.map((n) => n.id) : rootIds;
  const ids = withDescendants(nodes, roots);
  const deleted = new Set(ids);

  const deps = new Map<string, { taskId: string; dependsOnTaskId: string }>();
  for (const part of chunks(ids)) {
    const [a, b] = await Promise.all([
      supabase.from("task_dependencies").select("id, task_id, depends_on_task_id").in("task_id", part),
      supabase.from("task_dependencies").select("id, task_id, depends_on_task_id").in("depends_on_task_id", part),
    ]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    for (const d of [...a.data, ...b.data]) deps.set(d.id, { taskId: d.task_id, dependsOnTaskId: d.depends_on_task_id });
  }

  const [comments, attachments, timeEntries] = await Promise.all([
    countIn(supabase, "task_comments", ids),
    countIn(supabase, "task_attachments", ids),
    countIn(supabase, "time_entries", ids),
  ]);
  // For a task delete, the task itself is not one of "its" subtasks.
  const ownRoots = new Set(rootIds === "ALL" ? [] : rootIds);
  const subtasks = nodes.filter((n) => deleted.has(n.id) && n.parentId !== null && !ownRoots.has(n.id)).length;
  return {
    // A task delete reports its subtasks only; a project delete reports all tasks.
    tasks: rootIds === "ALL" ? ids.length : 0,
    subtasks,
    comments,
    attachments,
    timeEntries,
    outsideDependencies: countOutsideDependencies([...deps.values()], deleted),
  };
}
