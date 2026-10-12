"use server";

import { refresh } from "next/cache";

import { dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

export async function markNotificationRead(id: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(id)) return fail("Invalid notification.");
  const { error } = await actor.supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("user_id", actor.userId);
  if (error) return fail(dbError(error));
  refresh();
  return ok();
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  const { error } = await actor.supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", actor.userId)
    .eq("is_read", false);
  if (error) return fail(dbError(error));
  refresh();
  return ok();
}
