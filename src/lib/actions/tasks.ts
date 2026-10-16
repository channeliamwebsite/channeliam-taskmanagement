"use server";

import { refresh } from "next/cache";

import { isPriority, isTaskStatus, isTaskType, type Priority, type TaskStatus, type TaskType } from "@/lib/domain";

import {
  NOT_PERMITTED,
  cleanText,
  dbError,
  fail,
  getActor,
  isUuid,
  ok,
  parseDate,
  type ActionResult,
} from "./shared";

export type TaskInput = {
  /** Optional: defaults to the workspace's General project. */
  projectId?: string | null;
  /** Required when no project is given. */
  workspaceId?: string | null;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  taskType?: TaskType;
  startDate?: string | null;
  scheduledDate?: string | null;
  dueDate?: string | null;
  estimatedHours?: number | string | null;
  assigneeIds?: string[];
  primaryAssigneeId?: string | null;
};

type ValidatedFields = {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  task_type: TaskType;
  start_date: string | null;
  scheduled_date: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  parent_task_id: string | null;
};

function validateFields(input: Omit<TaskInput, "projectId">): ActionResult<ValidatedFields> {
  const title = cleanText(input.title, 500);
  if (!title) return fail("Title is required.");

  const status = input.status ?? "TODO";
  const priority = input.priority ?? "MEDIUM";
  const taskType = input.taskType ?? "TASK";
  if (!isTaskStatus(status) || !isPriority(priority) || !isTaskType(taskType)) {
    return fail("Invalid status, priority or type.");
  }

  const startDate = parseDate(input.startDate);
  const scheduledDate = parseDate(input.scheduledDate);
  const dueDate = parseDate(input.dueDate);
  if (startDate === undefined || scheduledDate === undefined || dueDate === undefined) return fail("Dates must be valid.");
  if (startDate && dueDate && dueDate < startDate) return fail("Due date cannot be before the start date.");

  let estimated: number | null = null;
  if (input.estimatedHours !== null && input.estimatedHours !== undefined && input.estimatedHours !== "") {
    estimated = Number(input.estimatedHours);
    if (!Number.isFinite(estimated) || estimated < 0 || estimated > 99999) {
      return fail("Estimated hours must be a positive number.");
    }
    estimated = Math.round(estimated * 100) / 100;
  }

  const parent = input.parentTaskId || null;
  if (parent !== null && !isUuid(parent)) return fail("Invalid parent task.");

  return ok({
    title,
    description: cleanText(input.description, 20000),
    status,
    priority,
    task_type: taskType,
    start_date: startDate,
    scheduled_date: scheduledDate,
    due_date: dueDate,
    estimated_hours: estimated,
    parent_task_id: parent,
  });
}

function validateAssignees(ids: unknown, primary: unknown): ActionResult<{ ids: string[]; primary: string | null }> {
  const list = Array.isArray(ids) ? [...new Set(ids)] : [];
  if (!list.every(isUuid)) return fail("Invalid assignee.");
  if (list.length > 50) return fail("Too many assignees.");
  const primaryId = primary && isUuid(primary) && list.includes(primary) ? primary : (list[0] ?? null);
  return ok({ ids: list as string[], primary: primaryId });
}

/**
 * Creates a task and its assignees atomically (public.create_task runs as the
 * caller, so RLS and triggers still decide). Without a project, the task goes
 * into the workspace's default General project. Individuals may only create
 * tasks assigned to themselves in the General project — enforced here and by
 * the database policies.
 */
export async function createTask(input: TaskInput): Promise<ActionResult<{ id: string }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  const { supabase, userId, profile } = actor;
  const isIndividual = profile.role === "INDIVIDUAL";

  const fields = validateFields(input);
  if (!fields.ok) return fields;
  if (!fields.data.start_date || !fields.data.due_date) return fail("Start date and due date are required.");
  // The day the work is planned for defaults to its start date.
  fields.data.scheduled_date ??= fields.data.start_date;

  let assignees: { ids: string[]; primary: string | null };
  if (isIndividual) {
    const requested = (input.assigneeIds ?? []).filter(Boolean);
    if (requested.some((id) => id !== userId)) return fail("You can only create tasks assigned to yourself.");
    assignees = { ids: [userId], primary: userId };
  } else {
    const parsed = validateAssignees(input.assigneeIds, input.primaryAssigneeId);
    if (!parsed.ok) return parsed;
    if (parsed.data.ids.length === 0) return fail("Assign at least one person.");
    assignees = parsed.data;
  }

  let projectId = input.projectId || null;
  if (projectId !== null && !isUuid(projectId)) return fail("Invalid project.");
  if (isIndividual && fields.data.parent_task_id) {
    const { data: parent } = await supabase.from("tasks").select("created_by").eq("id", fields.data.parent_task_id).maybeSingle();
    if (parent?.created_by !== userId) return fail("You can only add subtasks to tasks you created.");
  }
  if (isIndividual && projectId !== null) {
    // Individuals may use the General project or any project they can already see (RLS-scoped read).
    const { data: chosen } = await supabase.from("projects").select("id").eq("id", projectId).maybeSingle();
    if (!chosen) return fail("You can't add tasks to that project.");
  }
  if (projectId === null) {
    if (!isUuid(input.workspaceId)) return fail("Choose a workspace.");
    const { data: general, error: generalError } = await supabase
      .from("projects")
      .select("id")
      .eq("workspace_id", input.workspaceId!)
      .eq("is_default", true)
      .maybeSingle();
    if (generalError) return fail(dbError(generalError));
    if (!general) return fail("This workspace has no General project yet. Ask a super admin.");
    projectId = general.id;
  }

  const { data: taskId, error } = await supabase.rpc("create_task", {
    p_project_id: projectId,
    p_title: fields.data.title,
    p_assignee_ids: assignees.ids,
    p_primary_assignee_id: assignees.primary ?? undefined,
    p_parent_task_id: fields.data.parent_task_id ?? undefined,
    p_description: fields.data.description ?? undefined,
    p_status: fields.data.status,
    p_priority: fields.data.priority,
    p_task_type: fields.data.task_type,
    p_start_date: fields.data.start_date ?? undefined,
    p_scheduled_date: fields.data.scheduled_date ?? undefined,
    p_due_date: fields.data.due_date ?? undefined,
    p_estimated_hours: fields.data.estimated_hours ?? undefined,
  });
  if (error || !taskId) return fail(dbError(error, "Could not create the task."));

  refresh();
  return ok({ id: taskId });
}
export async function updateTask(taskId: string, input: Omit<TaskInput, "projectId" | "assigneeIds" | "primaryAssigneeId">): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(taskId)) return fail("Invalid task.");

  const fields = validateFields(input);
  if (!fields.ok) return fields;
  if (fields.data.parent_task_id === taskId) return fail("A task cannot be its own parent.");

  const update = { ...fields.data, ...(fields.data.status === "COMPLETED" ? { progress: 100 } : {}) };
  const { data, error } = await actor.supabase.from("tasks").update(update).eq("id", taskId).select("id");
  if (error) return fail(dbError(error, "Could not update the task."));
  if (!data.length) return fail(NOT_PERMITTED);

  refresh();
  return ok();
}

export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(taskId) || !isTaskStatus(status)) return fail("Invalid request.");

  const update: { status: TaskStatus; progress?: number } = { status };
  if (status === "COMPLETED") update.progress = 100;

  const { data, error } = await actor.supabase.from("tasks").update(update).eq("id", taskId).select("id");
  if (error) return fail(dbError(error, "Could not update the status."));
  if (!data.length) return fail(NOT_PERMITTED);

  refresh();
  return ok();
}

export async function updateTaskProgress(taskId: string, progress: number): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  const value = Math.round(Number(progress));
  if (!isUuid(taskId) || !Number.isFinite(value) || value < 0 || value > 100) return fail("Invalid progress.");

  const { data, error } = await actor.supabase.from("tasks").update({ progress: value }).eq("id", taskId).select("id");
  if (error) return fail(dbError(error, "Could not update progress."));
  if (!data.length) return fail(NOT_PERMITTED);

  refresh();
  return ok();
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(taskId)) return fail("Invalid task.");

  const { data, error } = await actor.supabase.from("tasks").delete().eq("id", taskId).select("id");
  if (error) return fail(dbError(error, "Could not delete the task."));
  if (!data.length) return fail(NOT_PERMITTED);

  refresh();
  return ok();
}

/** Replaces the assignee set (assign / reassign / unassign / change primary). */
export async function setTaskAssignees(taskId: string, assigneeIds: string[], primaryId: string | null): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role === "INDIVIDUAL") return fail("Only admins can assign tasks.");
  if (!isUuid(taskId)) return fail("Invalid task.");
  const parsed = validateAssignees(assigneeIds, primaryId);
  if (!parsed.ok) return parsed;

  // One database transaction: removals, additions and the primary change all
  // succeed together or not at all (public.set_task_assignees, RLS applies).
  const { error } = await actor.supabase.rpc("set_task_assignees", {
    p_task_id: taskId,
    p_user_ids: parsed.data.ids,
    p_primary_id: parsed.data.primary ?? undefined,
  });
  if (error) return fail(dbError(error, "Could not update the assignees."));

  refresh();
  return ok();
}
export async function addComment(taskId: string, text: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  const comment = cleanText(text, 10000);
  if (!isUuid(taskId)) return fail("Invalid task.");
  if (!comment) return fail("Comment cannot be empty.");

  const { error } = await actor.supabase
    .from("task_comments")
    .insert({ task_id: taskId, comment, user_id: actor.userId });
  if (error) return fail(dbError(error, "Could not add the comment."));

  refresh();
  return ok();
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(commentId)) return fail("Invalid comment.");

  const { data, error } = await actor.supabase.from("task_comments").delete().eq("id", commentId).select("id");
  if (error) return fail(dbError(error, "Could not delete the comment."));
  if (!data.length) return fail(NOT_PERMITTED);

  refresh();
  return ok();
}

/** Plans a task for a day (or clears it). Assignees may schedule their own work; RLS enforces it. */
export async function setTaskSchedule(taskId: string, scheduledDate: string | null): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(taskId)) return fail("Invalid task.");
  const date = parseDate(scheduledDate);
  if (date === undefined) return fail("Choose a valid date.");

  const { data, error } = await actor.supabase
    .from("tasks")
    .update({ scheduled_date: date })
    .eq("id", taskId)
    .select("id");
  if (error) return fail(dbError(error, "Could not schedule the task."));
  if (!data.length) return fail(NOT_PERMITTED);

  refresh();
  return ok();
}

/** Tasks in a project that can be chosen as a parent when creating a task. */
export async function getParentTaskOptions(projectId: string): Promise<ActionResult<{ id: string; title: string }[]>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(projectId)) return fail("Invalid project.");
  let query = actor.supabase
    .from("tasks")
    .select("id, title")
    .eq("project_id", projectId)
    .not("status", "in", "(COMPLETED,CANCELLED)")
    .order("title")
    .limit(500);
  // Individuals may only nest under tasks they created themselves (RLS enforces this too).
  if (actor.profile.role === "INDIVIDUAL") query = query.eq("created_by", actor.userId);
  const { data, error } = await query;
  if (error) return fail(dbError(error));
  return ok(data);
}