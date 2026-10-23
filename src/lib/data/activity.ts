import "server-only";

import type { ActivityAction } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import { loadError } from "./errors";

export type ActivityItem = {
  id: string;
  action: ActivityAction;
  createdAt: string;
  actorName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  oldValue: Json | null;
  newValue: Json | null;
};

const SELECT = `
  id, action, created_at, task_id, project_id, old_value, new_value,
  actor:profiles!activity_logs_user_id_fkey(full_name, email),
  task:tasks!activity_logs_task_id_fkey(title),
  project:projects!activity_logs_project_id_fkey(name)
`;

type Row = {
  id: string;
  action: ActivityAction;
  created_at: string;
  task_id: string | null;
  project_id: string | null;
  old_value: Json | null;
  new_value: Json | null;
  actor: { full_name: string | null; email: string | null } | null;
  task: { title: string } | null;
  project: { name: string } | null;
};

function toItem(r: Row): ActivityItem {
  return {
    id: r.id,
    action: r.action,
    createdAt: r.created_at,
    actorName: r.actor?.full_name || r.actor?.email || null,
    taskId: r.task_id,
    taskTitle: r.task?.title ?? null,
    projectId: r.project_id,
    projectName: r.project?.name ?? null,
    oldValue: r.old_value,
    newValue: r.new_value,
  };
}

/** Recent activity the caller may read (RLS limits rows to accessible tasks/projects). */
export async function listActivity(opts: { workspaceId: string; taskId?: string; projectId?: string; limit?: number }) {
  const supabase = await createClient();
  let query = supabase
    .from("activity_logs")
    .select(SELECT)
    .eq("workspace_id", opts.workspaceId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20);
  if (opts.taskId) query = query.eq("task_id", opts.taskId);
  if (opts.projectId) query = query.eq("project_id", opts.projectId);
  const { data, error } = await query;
  if (error) throw loadError("Failed to load activity", error);
  return (data as unknown as Row[]).map(toItem);
}
