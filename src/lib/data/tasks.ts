import "server-only";

import { cache } from "react";

import type { Session } from "@/lib/auth/dal";
import { todayISO, type Priority, type TaskStatus, type TaskType } from "@/lib/domain";
import { isCarriedForward as isCarriedForwardPure, taskFlags as taskFlagsPure } from "@/lib/scheduling";
import { createClient } from "@/lib/supabase/server";

export type AssigneeSummary = {
  userId: string;
  isPrimary: boolean;
  assignedBy: string | null;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type TaskSummary = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  taskType: TaskType;
  startDate: string | null;
  /** Day the work is planned for (distinct from start and due dates). */
  scheduledDate: string | null;
  dueDate: string | null;
  progress: number;
  parentTaskId: string | null;
  projectId: string;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  createdBy: string | null;
  updatedAt: string;
  /** Set by the database when the task becomes COMPLETED; null otherwise. */
  completedAt: string | null;
  assignees: AssigneeSummary[];
  /** Direct subtasks the caller can see. */
  subtaskTotal: number;
  subtaskDone: number;
};

const TASK_SUMMARY_SELECT = `
  id, title, status, priority, task_type, start_date, scheduled_date, due_date, progress,
  parent_task_id, project_id, created_by, updated_at, completed_at,
  project:projects!tasks_project_id_fkey(name, client_id, client_name, client:clients!projects_client_id_fkey(name)),
  assignees:task_assignees!task_assignees_task_id_fkey(
    user_id, is_primary, assigned_by,
    profile:profiles!task_assignees_user_id_fkey(full_name, email, avatar_url)
  )
` as const;

type TaskSummaryRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  task_type: TaskType;
  start_date: string | null;
  scheduled_date: string | null;
  due_date: string | null;
  progress: number;
  parent_task_id: string | null;
  project_id: string;
  created_by: string | null;
  updated_at: string;
  completed_at: string | null;
  project: { name: string; client_id: string | null; client_name: string | null; client: { name: string } | null } | null;
  assignees: {
    user_id: string;
    is_primary: boolean;
    assigned_by: string | null;
    profile: { full_name: string | null; email: string | null; avatar_url: string | null } | null;
  }[];
};

function toSummary(row: TaskSummaryRow, counts?: Map<string, { total: number; done: number }>): TaskSummary {
  const c = counts?.get(row.id) ?? { total: 0, done: 0 };
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    taskType: row.task_type,
    startDate: row.start_date,
    scheduledDate: row.scheduled_date,
    dueDate: row.due_date,
    progress: row.progress,
    parentTaskId: row.parent_task_id,
    projectId: row.project_id,
    projectName: row.project?.name ?? null,
    clientId: row.project?.client_id ?? null,
    clientName: row.project?.client?.name ?? row.project?.client_name ?? null,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    subtaskTotal: c.total,
    subtaskDone: c.done,
    assignees: row.assignees
      .map((a) => ({
        userId: a.user_id,
        isPrimary: a.is_primary,
        assignedBy: a.assigned_by,
        fullName: a.profile?.full_name ?? null,
        email: a.profile?.email ?? null,
        avatarUrl: a.profile?.avatar_url ?? null,
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
  };
}

/** Direct-subtask completion counts for the given parents (RLS-scoped). */
async function subtaskCounts(parentIds: string[]) {
  const counts = new Map<string, { total: number; done: number }>();
  if (parentIds.length === 0) return counts;
  const supabase = await createClient();
  for (let i = 0; i < parentIds.length; i += 200) {
    const { data, error } = await supabase
      .from("tasks")
      .select("parent_task_id, status")
      .in("parent_task_id", parentIds.slice(i, i + 200))
      .neq("status", "CANCELLED");
    if (error) throw new Error("Failed to load subtask progress");
    for (const r of data) {
      const c = counts.get(r.parent_task_id!) ?? { total: 0, done: 0 };
      c.total += 1;
      if (r.status === "COMPLETED") c.done += 1;
      counts.set(r.parent_task_id!, c);
    }
  }
  return counts;
}

export type TaskFilters = {
  workspaceId: string;
  projectId?: string;
  projectIds?: string[];
  assigneeId?: string;
  createdBy?: string;
  status?: TaskStatus;
  priority?: Priority;
  /** Exclude completed and cancelled tasks. */
  openOnly?: boolean;
  search?: string;
  /** Tasks whose scheduled or due date falls in [from, to]. */
  dateRange?: { from: string; to: string };
};

/** Tasks visible to the caller (RLS-scoped), newest activity first. */
export async function listTasks(filters: TaskFilters): Promise<TaskSummary[]> {
  const supabase = await createClient();

  let taskIds: string[] | null = null;
  if (filters.assigneeId) {
    const { data, error } = await supabase
      .from("task_assignees")
      .select("task_id")
      .eq("user_id", filters.assigneeId);
    if (error) throw new Error("Failed to load assignments");
    taskIds = data.map((r) => r.task_id);
    if (taskIds.length === 0) return [];
  }
  if (filters.projectIds && filters.projectIds.length === 0) return [];

  let query = supabase
    .from("tasks")
    .select(TASK_SUMMARY_SELECT)
    .eq("workspace_id", filters.workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (taskIds) query = query.in("id", taskIds);
  if (filters.projectId) query = query.eq("project_id", filters.projectId);
  if (filters.projectIds) query = query.in("project_id", filters.projectIds);
  if (filters.createdBy) query = query.eq("created_by", filters.createdBy);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.openOnly) query = query.not("status", "in", "(COMPLETED,CANCELLED)");
  if (filters.dateRange) {
    const { from, to } = filters.dateRange;
    query = query.or(
      `and(scheduled_date.gte.${from},scheduled_date.lte.${to}),and(due_date.gte.${from},due_date.lte.${to})`,
    );
  }
  if (filters.search?.trim()) {
    const term = filters.search.trim().slice(0, 100).replace(/[\\%_]/g, (ch) => `\\${ch}`);
    query = query.ilike("title", `%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error("Failed to load tasks");
  const rows = data as unknown as TaskSummaryRow[];
  const counts = await subtaskCounts(rows.map((r) => r.id));
  return rows.map((r) => toSummary(r, counts));
}

export type TaskDetail = TaskSummary & {
  description: string | null;
  estimatedHours: number | null;
  actualHours: number;
  createdAt: string;
  creatorName: string | null;
  workspaceId: string;
  parent: { id: string; title: string } | null;
  ancestors: { id: string; title: string }[];
  subtasks: TaskSummary[];
  permissions: { canManage: boolean; canUpdateStatus: boolean; canDelete: boolean };
};

export const getTask = cache(async (taskId: string, session: Session): Promise<TaskDetail | null> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tasks")
    .select(
      `${TASK_SUMMARY_SELECT}, description, estimated_hours, actual_hours, created_at, workspace_id,
       creator:profiles!tasks_created_by_fkey(full_name, email),
       projectInfo:projects!tasks_project_id_fkey(owner_id, created_by)`,
    )
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new Error("Failed to load task");
  if (!data) return null;

  const row = data as unknown as TaskSummaryRow & {
    description: string | null;
    estimated_hours: number | null;
    actual_hours: number;
    created_at: string;
    workspace_id: string;
    creator: { full_name: string | null; email: string | null } | null;
    projectInfo: { owner_id: string | null; created_by: string | null } | null;
  };

  // Ancestor chain (breadcrumb). Hidden ancestors simply end the chain.
  const ancestors: { id: string; title: string }[] = [];
  let parentId = row.parent_task_id;
  for (let depth = 0; parentId && depth < 20; depth++) {
    const { data: parent } = await supabase
      .from("tasks")
      .select("id, title, parent_task_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent) break;
    ancestors.unshift({ id: parent.id, title: parent.title });
    parentId = parent.parent_task_id;
  }

  const { data: children, error: childError } = await supabase
    .from("tasks")
    .select(TASK_SUMMARY_SELECT)
    .eq("parent_task_id", taskId)
    .order("created_at");
  if (childError) throw new Error("Failed to load subtasks");
  const childRows = children as unknown as TaskSummaryRow[];
  const counts = await subtaskCounts([row.id, ...childRows.map((c) => c.id)]);

  const summary = toSummary(row, counts);
  const userId = session.user.id;
  const role = session.profile.role;
  const involved =
    row.created_by === userId ||
    row.projectInfo?.owner_id === userId ||
    row.projectInfo?.created_by === userId ||
    summary.assignees.some((a) => a.userId === userId || a.assignedBy === userId);
  // Mirrors private.can_manage_task (the database remains authoritative).
  const canManage = role === "SUPER_ADMIN" || (role === "ADMIN" && involved);
  const isAssignee = summary.assignees.some((a) => a.userId === userId);

  return {
    ...summary,
    description: row.description,
    estimatedHours: row.estimated_hours,
    actualHours: row.actual_hours,
    createdAt: row.created_at,
    creatorName: row.creator?.full_name || row.creator?.email || null,
    workspaceId: row.workspace_id,
    parent: ancestors.at(-1) ?? null,
    ancestors,
    subtasks: childRows.map((c) => toSummary(c, counts)),
    permissions: {
      canManage,
      canUpdateStatus: canManage || isAssignee,
      canDelete: role === "SUPER_ADMIN" || (role === "ADMIN" && row.created_by === userId),
    },
  };
});

export type Comment = {
  id: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  userId: string | null;
  authorName: string | null;
};

export async function getTaskComments(taskId: string): Promise<Comment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_comments")
    .select("id, comment, created_at, updated_at, user_id, author:profiles!task_comments_user_id_fkey(full_name, email)")
    .eq("task_id", taskId)
    .order("created_at");
  if (error) throw new Error("Failed to load comments");
  return data.map((c) => ({
    id: c.id,
    comment: c.comment,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    userId: c.user_id,
    authorName: c.author?.full_name || c.author?.email || null,
  }));
}

/** Possible parents for a task: tasks in the same project, excluding itself and its descendants. */
export async function getParentCandidates(projectId: string, excludeTaskId?: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, parent_task_id")
    .eq("project_id", projectId)
    .order("title");
  if (error) throw new Error("Failed to load tasks");
  if (!excludeTaskId) return data.map(({ id, title }) => ({ id, title }));

  const excluded = new Set([excludeTaskId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of data) {
      if (t.parent_task_id && excluded.has(t.parent_task_id) && !excluded.has(t.id)) {
        excluded.add(t.id);
        grew = true;
      }
    }
  }
  return data.filter((t) => !excluded.has(t.id)).map(({ id, title }) => ({ id, title }));
}

/** Shapes tasks for list/board views, with a best-effort permission hint. */
export function toTaskRows(tasks: TaskSummary[], session: Session, today = todayISO()) {
  const userId = session.user.id;
  const role = session.profile.role;
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    scheduledDate: t.scheduledDate,
    dueDate: t.dueDate,
    progress: t.progress,
    parentTaskId: t.parentTaskId,
    projectName: t.projectName,
    clientName: t.clientName,
    subtaskTotal: t.subtaskTotal,
    subtaskDone: t.subtaskDone,
    assignees: t.assignees.map((a) => ({ userId: a.userId, name: a.fullName || a.email || "Unknown user" })),
    flags: taskFlags(t, today),
    canUpdateStatus:
      role === "SUPER_ADMIN" ||
      t.assignees.some((a) => a.userId === userId) ||
      (role === "ADMIN" && (t.createdBy === userId || t.assignees.some((a) => a.assignedBy === userId))),
  }));
}

/** Carry-forward rules live in a pure module (unit-tested); re-exported here. */
export function isCarriedForward(t: Pick<TaskSummary, "scheduledDate" | "status">, today = todayISO()) {
  return isCarriedForwardPure(t, today);
}

export function taskFlags(t: TaskSummary, today = todayISO()) {
  return taskFlagsPure(t, today);
}