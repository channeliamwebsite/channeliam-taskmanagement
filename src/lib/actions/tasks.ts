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
  projectId: string;
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

export async function createTask(input: TaskInput): Promise<ActionResult<{ id: string }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role === "INDIVIDUAL") return fail("Only admins can create tasks.");
  if (!isUuid(input.projectId)) return fail("Choose a project.");

  const fields = validateFields(input);
  if (!fields.ok) return fields;
  const assignees = validateAssignees(input.assigneeIds, input.primaryAssigneeId);
  if (!assignees.ok) return assignees;
  if (assignees.data.ids.length === 0) return fail("Assign at least one person.");

  const { supabase, userId } = actor;
  const progress = fields.data.status === "COMPLETED" ? 100 : 0;

  const { data: project } = await supabase
    .from("projects")
    .select("workspace_id")
    .eq("id", input.projectId)
    .maybeSingle();
  if (!project) return fail("Project not found.");

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      ...fields.data,
      progress,
      project_id: input.projectId,
      created_by: userId,
      // The database also derives this from the project.
      workspace_id: project.workspace_id,
    })
    .select("id")
    .single();

  if (error || !task) return fail(dbError(error, "Could not create the task."));

  if (assignees.data.ids.length) {
    const { error: assignError } = await supabase.from("task_assignees").insert(
      assignees.data.ids.map((uid) => ({
        task_id: task.id,
        user_id: uid,
        assigned_by: userId,
        is_primary: uid === assignees.data.primary,
      })),
    );
    if (assignError) {
      refresh();
      return fail(`Task created, but assigning failed: ${dbError(assignError)}`);
    }
  }

  refresh();
  return ok({ id: task.id });
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

  const { supabase, userId } = actor;
  const { data: current, error: loadError } = await supabase
    .from("task_assignees")
    .select("user_id, is_primary")
    .eq("task_id", taskId);
  if (loadError) return fail(dbError(loadError));

  const currentIds = new Set(current.map((a) => a.user_id));
  const next = new Set(parsed.data.ids);
  const toRemove = [...currentIds].filter((id) => !next.has(id));
  const toAdd = parsed.data.ids.filter((id) => !currentIds.has(id));

  if (toRemove.length) {
    const { data, error } = await supabase
      .from("task_assignees")
      .delete()
      .eq("task_id", taskId)
      .in("user_id", toRemove)
      .select("id");
    if (error) return fail(dbError(error, "Could not remove assignees."));
    if (data.length !== toRemove.length) return fail(NOT_PERMITTED);
  }

  if (toAdd.length) {
    const { error } = await supabase.from("task_assignees").insert(
      toAdd.map((uid) => ({ task_id: taskId, user_id: uid, assigned_by: userId, is_primary: false })),
    );
    if (error) return fail(dbError(error, "Could not assign users."));
  }

  const primary = parsed.data.primary;
  const currentPrimary = current.find((a) => a.is_primary)?.user_id ?? null;
  if (primary && primary !== currentPrimary) {
    // The database demotes the previous primary automatically.
    const { data, error } = await supabase
      .from("task_assignees")
      .update({ is_primary: true })
      .eq("task_id", taskId)
      .eq("user_id", primary)
      .select("id");
    if (error) return fail(dbError(error, "Could not set the primary assignee."));
    if (!data.length) return fail(NOT_PERMITTED);
  }

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
  const { data, error } = await actor.supabase
    .from("tasks")
    .select("id, title")
    .eq("project_id", projectId)
    .not("status", "in", "(COMPLETED,CANCELLED)")
    .order("title")
    .limit(500);
  if (error) return fail(dbError(error));
  return ok(data);
}