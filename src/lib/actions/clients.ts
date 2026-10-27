"use server";

import { refresh } from "next/cache";

import { NOT_PERMITTED, cleanText, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

export type ClientInput = { name: string; contactName?: string; contactEmail?: string; notes?: string };

function validate(input: ClientInput) {
  const name = cleanText(input.name, 200);
  if (!name) return fail("Client name is required.");
  const email = cleanText(input.contactEmail, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid contact email.");
  return ok({
    name,
    contact_name: cleanText(input.contactName, 200),
    contact_email: email,
    notes: cleanText(input.notes, 5000),
  });
}

export async function createClient(workspaceId: string, input: ClientInput): Promise<ActionResult<{ id: string }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role === "INDIVIDUAL") return fail("Only admins can add clients.");
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");
  const fields = validate(input);
  if (!fields.ok) return fields;

  const { data, error } = await actor.supabase
    .from("clients")
    .insert({ ...fields.data, workspace_id: workspaceId, created_by: actor.userId })
    .select("id")
    .single();
  if (error || !data) {
    return fail(error?.code === "23505" ? "A client with that name already exists." : dbError(error, "Could not add the client."));
  }
  refresh();
  return ok({ id: data.id });
}

const CLIENT_HAS_PROJECTS = (n?: number) =>
  `This client still has ${n ? `${n} project${n === 1 ? "" : "s"}` : "projects"}. Move them to another client or delete them first.`;

/** Read-only: the projects that still belong to this client (they block deletion). */
export async function getClientDeletionImpact(clientId: string): Promise<ActionResult<{ projects: { id: string; name: string }[] }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can delete clients.");
  if (!isUuid(clientId)) return fail("Invalid client.");
  const { data: client } = await actor.supabase.from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return fail(NOT_PERMITTED);
  const { data, error } = await actor.supabase.from("projects").select("id, name").eq("client_id", clientId).order("name");
  if (error) return fail(dbError(error));
  return ok({ projects: data });
}

/**
 * Deletion policy: a client is deleted only when no project belongs to it.
 * Projects are never deleted or detached as a side effect; move or delete them
 * first. The database enforces the same rule (migration 014). RLS: super admins.
 */
export async function deleteClient(clientId: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can delete clients.");
  if (!isUuid(clientId)) return fail("Invalid client.");
  const { supabase } = actor;

  const { count, error: countError } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);
  if (countError) return fail(dbError(countError, "Could not delete the client."));
  if (count) return fail(CLIENT_HAS_PROJECTS(count));

  const { data, error } = await supabase.from("clients").delete().eq("id", clientId).select("id");
  if (error) return fail(error.code === "23503" ? CLIENT_HAS_PROJECTS() : dbError(error, "Could not delete the client."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

export async function updateClient(clientId: string, input: ClientInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(clientId)) return fail("Invalid client.");
  const fields = validate(input);
  if (!fields.ok) return fields;

  const { data, error } = await actor.supabase.from("clients").update(fields.data).eq("id", clientId).select("id");
  if (error) return fail(error.code === "23505" ? "A client with that name already exists." : dbError(error));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}
