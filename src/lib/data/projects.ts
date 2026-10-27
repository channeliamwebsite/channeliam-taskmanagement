import "server-only";

import type { Priority, ProjectStatus, TaskStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { countLeafTasks, percent } from "@/lib/progress";
import { PAGE_SIZE, chunk, fetchAllPages } from "@/lib/task-query";
import { loadError } from "./errors";

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  clientName: string | null;
  clientId: string | null;
  status: ProjectStatus;
  priority: Priority;
  startDate: string | null;
  dueDate: string | null;
  ownerId: string | null;
  ownerName: string | null;
  createdBy: string | null;
  totalTasks: number;
  completedTasks: number;
  progress: number;
};

const PROJECT_SELECT =
  "id, name, description, client_name, client_id, status, priority, start_date, due_date, owner_id, created_by, owner:profiles!projects_owner_id_fkey(full_name, email), client:clients!projects_client_id_fkey(name)";

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  client_name: string | null;
  client_id: string | null;
  client: { name: string } | null;
  status: ProjectStatus;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  owner_id: string | null;
  created_by: string | null;
  owner: { full_name: string | null; email: string | null } | null;
};

/** Task counts per project, computed from tasks visible to the caller. */
async function taskCounts(projectIds: string[]) {
  const counts = new Map<string, { total: number; completed: number }>();
  if (projectIds.length === 0) return counts;
  const supabase = await createClient();
  // Every visible task is read (pages are walked by id instead of stopping at
  // the API row limit); only leaf tasks are counted, so a parent and its
  // subtasks are not counted twice.
  const rows: { id: string; project_id: string; status: TaskStatus; parent_task_id: string | null }[] = [];
  for (const ids of chunk(projectIds)) {
    rows.push(
      ...(await fetchAllPages((after) => {
        let q = supabase.from("tasks").select("id, project_id, status, parent_task_id").in("project_id", ids).neq("status", "CANCELLED");
        if (after) q = q.gt("id", after);
        return q.order("id").limit(PAGE_SIZE);
      }, "Failed to load project progress")),
    );
  }
  for (const [projectId, c] of countLeafTasks(
    rows.map((t) => ({ id: t.id, parentTaskId: t.parent_task_id, status: t.status, projectId: t.project_id })),
    (t) => t.projectId,
  )) {
    counts.set(projectId, c);
  }
  return counts;
}

function toSummary(row: ProjectRow, counts: Map<string, { total: number; completed: number }>): ProjectSummary {
  const c = counts.get(row.id) ?? { total: 0, completed: 0 };
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    clientName: row.client?.name ?? row.client_name,
    clientId: row.client_id,
    status: row.status,
    priority: row.priority,
    startDate: row.start_date,
    dueDate: row.due_date,
    ownerId: row.owner_id,
    ownerName: row.owner?.full_name || row.owner?.email || null,
    createdBy: row.created_by,
    totalTasks: c.total,
    completedTasks: c.completed,
    progress: percent(c.completed, c.total),
  };
}

export async function listProjects(workspaceId: string): Promise<ProjectSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw loadError("Failed to load projects", error);
  const rows = data as unknown as ProjectRow[];
  const counts = await taskCounts(rows.map((p) => p.id));
  return rows.map((row) => toSummary(row, counts));
}

export async function getProject(projectId: string): Promise<(ProjectSummary & { workspaceId: string; isDefault: boolean }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(`${PROJECT_SELECT}, workspace_id, is_default`)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw loadError("Failed to load project", error);
  if (!data) return null;
  const row = data as unknown as ProjectRow & { workspace_id: string; is_default: boolean };
  const counts = await taskCounts([row.id]);
  return { ...toSummary(row, counts), workspaceId: row.workspace_id, isDefault: row.is_default };
}

/** Lightweight list for pickers (with client, for Client → Project selection). */
export async function listProjectOptions(workspaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, status, is_default, client_id, client_name, client:clients!projects_client_id_fkey(name)")
    .eq("workspace_id", workspaceId)
    .neq("status", "ARCHIVED")
    .order("is_default", { ascending: false })
    .order("name");
  if (error) throw loadError("Failed to load projects", error);
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    isDefault: p.is_default,
    clientId: p.client_id,
    clientName: p.client?.name ?? p.client_name,
  }));
}
