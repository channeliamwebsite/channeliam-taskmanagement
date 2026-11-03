"use server";

import { refresh } from "next/cache";

import { dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

/**
 * Checks the caller in to a workspace they belong to. The time, the local
 * work date and every rule (membership, one open session) come from
 * public.attendance_check_in; nothing time-related is sent from the browser.
 */
export async function checkIn(workspaceId: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");

  const { error } = await actor.supabase.rpc("attendance_check_in", { p_workspace_id: workspaceId });
  if (error) return fail(dbError(error, "Could not check in. Please try again."));
  refresh();
  return ok();
}

/** Starts a break in the caller's open session (database time; one break at a time). */
export async function startBreak(): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  const { error } = await actor.supabase.rpc("attendance_start_break");
  if (error) return fail(dbError(error, "Could not start the break. Please try again."));
  refresh();
  return ok();
}

/** Ends the caller's running break at the database's current time. */
export async function endBreak(): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  const { error } = await actor.supabase.rpc("attendance_end_break");
  if (error) return fail(dbError(error, "Could not end the break. Please try again."));
  refresh();
  return ok();
}

/** Closes the caller's open session at the database's current time (and any running break). */
export async function checkOut(): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;

  const { error } = await actor.supabase.rpc("attendance_check_out");
  if (error) return fail(dbError(error, "Could not check out. Please try again."));
  refresh();
  return ok();
}
