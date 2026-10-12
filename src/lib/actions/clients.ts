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
