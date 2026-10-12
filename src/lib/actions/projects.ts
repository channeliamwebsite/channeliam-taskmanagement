"use server";

import { refresh } from "next/cache";

import { isPriority, isProjectStatus, type Priority, type ProjectStatus } from "@/lib/domain";

import { NOT_PERMITTED, cleanText, dbError, fail, getActor, isUuid, ok, parseDate, type ActionResult } from "./shared";

export type ProjectInput = {
  name: string;
  description?: string | null;
  clientName?: string | null;
  clientId?: string | null;
  status?: ProjectStatus;
  priority?: Priority;
  startDate?: string | null;
  dueDate?: string | null;
  ownerId?: string | null;
};

function validate(input: ProjectInput) {
  const name = cleanText(input.name, 200);
  if (!name) return fail("Project name is required.");
  const status = input.status ?? "PLANNING";
  const priority = input.priority ?? "MEDIUM";
  if (!isProjectStatus(status) || !isPriority(priority)) return fail("Invalid status or priority.");
  const start = parseDate(input.startDate);
  const due = parseDate(input.dueDate);
  if (start === undefined || due === undefined) return fail("Dates must be valid.");
  if (start && due && due < start) return fail("Due date cannot be before the start date.");
  const owner = input.ownerId || null;
  if (owner !== null && !isUuid(owner)) return fail("Invalid owner.");
  const client = input.clientId || null;
  if (client !== null && !isUuid(client)) return fail("Invalid client.");
  return ok({
    name,
    description: cleanText(input.description, 5000),
    client_name: cleanText(input.clientName, 200),
    client_id: client,
    status,
    priority,
    start_date: start,
    due_date: due,
    owner_id: owner,
  });
}

export async function createProject(workspaceId: string, input: ProjectInput): Promise<ActionResult<{ id: string }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role === "INDIVIDUAL") return fail("You don't have permission to create projects.");
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");
  const fields = validate(input);
  if (!fields.ok) return fields;

  const { data, error } = await actor.supabase
    .from("projects")
    .insert({ ...fields.data, workspace_id: workspaceId, created_by: actor.userId })
    .select("id")
    .single();
  if (error || !data) {
    return fail(
      error?.code === "42501"
        ? "You don't have permission to create projects in this workspace. Ask a super admin to enable it."
        : dbError(error, "Could not create the project."),
    );
  }
  refresh();
  return ok({ id: data.id });
}

export async function updateProject(projectId: string, input: ProjectInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(projectId)) return fail("Invalid project.");
  const fields = validate(input);
  if (!fields.ok) return fields;

  const { data, error } = await actor.supabase.from("projects").update(fields.data).eq("id", projectId).select("id");
  if (error) return fail(dbError(error, "Could not update the project."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

export async function deleteProject(projectId: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can delete projects.");
  if (!isUuid(projectId)) return fail("Invalid project.");

  const { data, error } = await actor.supabase.from("projects").delete().eq("id", projectId).select("id");
  if (error) return fail(dbError(error, "Could not delete the project."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}
