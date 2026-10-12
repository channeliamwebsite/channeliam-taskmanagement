import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { getCurrentProfile, getCurrentUser, type CurrentProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T>;
export function ok(): ActionResult<undefined>;
export function ok<T>(data?: T) {
  return { ok: true as const, data };
}

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** Authenticated, active caller for a server action (actions are public endpoints). */
export async function getActor(): Promise<
  { ok: true; userId: string; profile: CurrentProfile; supabase: Awaited<ReturnType<typeof createClient>> } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return fail("Your session has expired. Please sign in again.");
  const profile = await getCurrentProfile();
  if (!profile || !profile.isActive) return fail("Your account is not active.");
  return { ok: true, userId: user.id, profile, supabase: await createClient() };
}

// Messages raised by our own database triggers are safe and meaningful to show.
const SAFE_DB_MESSAGES = [
  "Task hierarchy cannot contain cycles",
  "Parent task must belong to the same project",
  "Assignee must be an active member",
  "Assignees without manage rights may only update status and progress",
  "Project owner must be an active member",
  "Only a super admin can change",
  "Super admins cannot change their own role",
  "A task cannot be moved to another project",
  "Task dependencies cannot contain cycles",
  "Reporting lines cannot contain cycles",
  "Client must belong to the same workspace",
  "Assign at least one person",
  "Project not found",
  "permission to assign this task",
  "permission to remove some assignees",
  "The default General project cannot be deleted",
];

/** Maps a database error to a user-facing message without leaking SQL details. */
export function dbError(error: PostgrestError | null, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  const safe = SAFE_DB_MESSAGES.find((m) => error.message?.includes(m));
  if (safe) return error.message;
  if (error.code === "42501") return "You don't have permission to do that.";
  if (error.code === "23505") return "That already exists.";
  if (error.code === "23503") return "A referenced record no longer exists.";
  if (error.code === "23514" || error.code === "22P02" || error.code === "22007") return "Some of the values are invalid.";
  console.error("Database error", error.code, error.message);
  return fallback;
}

export const NOT_PERMITTED = "You don't have permission to do that, or the item no longer exists.";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Empty -> null; invalid -> undefined (caller reports an error). */
export function parseDate(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? undefined : value;
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}
