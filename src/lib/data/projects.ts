import "server-only";

import type { Priority, ProjectStatus, TaskStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";

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
  const { data, error } = await supabase
    .from("tasks")
    .select("project_id, status")
    .in("project_id", projectIds)
    .neq("status", "CANCELLED")
    .limit(5000);
  if (error) throw new Error("Failed to load project progress");
  for (const t of data as { project_id: string; status: TaskStatus }[]) {
    const c = counts.get(t.project_id) ?? { total: 0, completed: 0 };
    c.total += 1;
    if (t.status === "COMPLETED") c.completed += 1;
    counts.set(t.project_id, c);
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
    progress: c.total ? Math.round((c.completed / c.total) * 100) : 0,
  };
}

export async function listProjects(workspaceId: string): Promise<ProjectSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_SELECT)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error("Failed to load projects");
  const rows = data as unknown as ProjectRow[];
  const counts = await taskCounts(rows.map((p) => p.id));
  return rows.map((row) => toSummary(row, counts));
}

export async function getProject(projectId: string): Promise<(ProjectSummary & { workspaceId: string }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(`${PROJECT_SELECT}, workspace_id`)
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error("Failed to load project");
  if (!data) return null;
  const row = data as unknown as ProjectRow & { workspace_id: string };
  const counts = await taskCounts([row.id]);
  return { ...toSummary(row, counts), workspaceId: row.workspace_id };
}

/** Lightweight list for pickers (with client, for Client → Project selection). */
export async function listProjectOptions(workspaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, status, client_id, client_name, client:clients!projects_client_id_fkey(name)")
    .eq("workspace_id", workspaceId)
    .neq("status", "ARCHIVED")
    .order("name");
  if (error) throw new Error("Failed to load projects");
  return data.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    clientId: p.client_id,
    clientName: p.client?.name ?? p.client_name,
  }));
}
