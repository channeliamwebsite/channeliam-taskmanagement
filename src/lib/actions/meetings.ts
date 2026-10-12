"use server";

import { refresh } from "next/cache";

import { NOT_PERMITTED, cleanText, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

export type MeetingLinkInput = {
  title: string;
  url: string;
  /** Empty = organisation-wide meeting. */
  team?: string | null;
  schedule?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

/** Only https links to a real host are accepted (the database enforces this too). */
function validUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname) && value.length <= 2000 ? url.toString() : null;
  } catch {
    return null;
  }
}

function validate(input: MeetingLinkInput) {
  const title = cleanText(input.title, 200);
  if (!title) return fail("Meeting name is required.");
  const url = validUrl(input.url ?? "");
  if (!url) return fail("Enter a valid https:// meeting link.");
  const order = Math.round(Number(input.sortOrder ?? 0));
  return ok({
    title,
    url,
    team: cleanText(input.team, 100),
    schedule: cleanText(input.schedule, 200),
    sort_order: Number.isFinite(order) ? order : 0,
    is_active: input.isActive ?? true,
  });
}

export async function createMeetingLink(workspaceId: string, input: MeetingLinkInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can manage meeting links.");
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");
  const fields = validate(input);
  if (!fields.ok) return fields;

  const { error } = await actor.supabase
    .from("meeting_links")
    .insert({ ...fields.data, workspace_id: workspaceId, created_by: actor.userId });
  if (error) return fail(dbError(error, "Could not save the meeting link."));
  refresh();
  return ok();
}

export async function updateMeetingLink(id: string, input: MeetingLinkInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can manage meeting links.");
  if (!isUuid(id)) return fail("Invalid meeting link.");
  const fields = validate(input);
  if (!fields.ok) return fields;

  const { data, error } = await actor.supabase.from("meeting_links").update(fields.data).eq("id", id).select("id");
  if (error) return fail(dbError(error, "Could not save the meeting link."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

export async function deleteMeetingLink(id: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can manage meeting links.");
  if (!isUuid(id)) return fail("Invalid meeting link.");

  const { data, error } = await actor.supabase.from("meeting_links").delete().eq("id", id).select("id");
  if (error) return fail(dbError(error, "Could not delete the meeting link."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}
