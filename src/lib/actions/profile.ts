"use server";

import { refresh } from "next/cache";

import { NOT_PERMITTED, cleanText, dbError, fail, getActor, ok, type ActionResult } from "./shared";

/** Users may edit their own display name (role/status are admin-managed). */
export async function updateMyName(fullName: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  const name = cleanText(fullName, 200);
  if (!name) return fail("Name is required.");

  const { data, error } = await actor.supabase
    .from("profiles")
    .update({ full_name: name })
    .eq("id", actor.userId)
    .select("id");
  if (error) return fail(dbError(error, "Could not update your name."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}
