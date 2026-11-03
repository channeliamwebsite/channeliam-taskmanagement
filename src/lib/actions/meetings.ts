"use server";

import { refresh } from "next/cache";

import { NOT_PERMITTED, cleanText, dbError, fail, getActor, isUuid, ok, parseDate, type ActionResult } from "./shared";

export type MeetingLinkInput = {
  title: string;
  url: string;
  /** Empty = organisation-wide meeting. */
  team?: string | null;
  schedule?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  kind?: "MORNING" | "EVENING" | "OTHER";
  /** HH:MM, workspace local time. */
  startsAt?: string | null;
  /** YYYY-MM-DD for a one-off meeting; empty = every day. */
  meetingDate?: string | null;
  description?: string | null;
  /** HH:MM, workspace local time; must be after startsAt. */
  endsAt?: string | null;
  /** Named participants (029); empty = the team / everyone audience. */
  participantIds?: string[];
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Super admins schedule in any workspace (025); admins in their own (029). RLS decides.
const MAY_SCHEDULE = ["SUPER_ADMIN", "ADMIN"];
const NOT_SCHEDULER = "Only admins and super admins can schedule meetings.";

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
  const kind = input.kind ?? "OTHER";
  if (!["MORNING", "EVENING", "OTHER"].includes(kind)) return fail("Choose a meeting type.");
  const startsAt = input.startsAt?.trim() || null;
  if (startsAt !== null && !TIME_RE.test(startsAt)) return fail("Enter a valid time.");
  const endsAt = input.endsAt?.trim() || null;
  if (endsAt !== null && !TIME_RE.test(endsAt)) return fail("Enter a valid end time.");
  if (endsAt !== null && (startsAt === null || endsAt <= startsAt)) return fail("The end time must be after the start time.");
  const meetingDate = parseDate(input.meetingDate);
  if (meetingDate === undefined) return fail("Enter a valid date.");
  return ok({
    title,
    url,
    team: cleanText(input.team, 100),
    schedule: cleanText(input.schedule, 200),
    sort_order: Number.isFinite(order) ? order : 0,
    is_active: input.isActive ?? true,
    kind,
    starts_at: startsAt,
    ends_at: endsAt,
    meeting_date: meetingDate,
    description: cleanText(input.description, 2000),
  });
}

function participantList(ids: string[] | undefined) {
  const list = [...new Set(ids ?? [])];
  return list.every(isUuid) ? list : null;
}

/** Makes the meeting's named participants exactly `ids` (RLS: meeting managers only). */
async function syncParticipants(
  supabase: Extract<Awaited<ReturnType<typeof getActor>>, { ok: true }>["supabase"],
  actorId: string,
  meetingId: string,
  ids: string[],
): Promise<string | null> {
  const { data: current, error } = await supabase.from("meeting_participants").select("user_id").eq("meeting_link_id", meetingId);
  if (error) return dbError(error);
  const have = new Set(current.map((r) => r.user_id));
  const add = ids.filter((id) => !have.has(id));
  const remove = [...have].filter((id) => !ids.includes(id));
  if (add.length) {
    const { error: addError } = await supabase
      .from("meeting_participants")
      .insert(add.map((user_id) => ({ meeting_link_id: meetingId, user_id, added_by: actorId })));
    if (addError) return dbError(addError, "Could not invite the participants.");
  }
  if (remove.length) {
    const { error: removeError } = await supabase.from("meeting_participants").delete().eq("meeting_link_id", meetingId).in("user_id", remove);
    if (removeError) return dbError(removeError, "Could not update the participants.");
  }
  return null;
}

export async function createMeetingLink(workspaceId: string, input: MeetingLinkInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!MAY_SCHEDULE.includes(actor.profile.role)) return fail(NOT_SCHEDULER);
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");
  const fields = validate(input);
  if (!fields.ok) return fields;

  const participants = participantList(input.participantIds);
  if (!participants) return fail("Choose valid participants.");

  const { data, error } = await actor.supabase
    .from("meeting_links")
    .insert({ ...fields.data, workspace_id: workspaceId, created_by: actor.userId })
    .select("id")
    .single();
  if (error || !data) return fail(dbError(error, "Could not save the meeting."));
  const participantError = await syncParticipants(actor.supabase, actor.userId, data.id, participants);
  refresh();
  if (participantError) return fail(`The meeting was saved, but: ${participantError}`);
  return ok();
}

export async function updateMeetingLink(id: string, input: MeetingLinkInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!MAY_SCHEDULE.includes(actor.profile.role)) return fail(NOT_SCHEDULER);
  if (!isUuid(id)) return fail("Invalid meeting link.");
  const fields = validate(input);
  if (!fields.ok) return fields;

  const participants = participantList(input.participantIds);
  if (!participants) return fail("Choose valid participants.");

  const { data, error } = await actor.supabase.from("meeting_links").update(fields.data).eq("id", id).select("id");
  if (error) return fail(dbError(error, "Could not save the meeting."));
  if (!data.length) return fail(NOT_PERMITTED);
  const participantError = await syncParticipants(actor.supabase, actor.userId, id, participants);
  refresh();
  if (participantError) return fail(`The meeting was saved, but: ${participantError}`);
  return ok();
}

/**
 * Read-only: how many meeting records (notes, decisions) the meeting has. A
 * meeting with records cannot be deleted (migration 031). Only super admins can
 * read records (013), so for anyone else the count is unknown (null), never 0.
 */
export async function getMeetingLinkDeletionImpact(id: string): Promise<ActionResult<{ records: number | null }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!MAY_SCHEDULE.includes(actor.profile.role)) return fail(NOT_SCHEDULER);
  if (!isUuid(id)) return fail("Invalid meeting link.");
  if (actor.profile.role !== "SUPER_ADMIN") return ok({ records: null });
  const { count, error } = await actor.supabase
    .from("meeting_records")
    .select("id", { count: "exact", head: true })
    .eq("meeting_link_id", id);
  if (error) return fail(dbError(error));
  return ok({ records: count ?? 0 });
}

/** Deletes a meeting without meeting records; one with records is refused (031) and should be deactivated instead. */
export async function deleteMeetingLink(id: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!MAY_SCHEDULE.includes(actor.profile.role)) return fail(NOT_SCHEDULER);
  if (!isUuid(id)) return fail("Invalid meeting link.");

  const { data, error } = await actor.supabase.from("meeting_links").delete().eq("id", id).select("id");
  if (error) return fail(dbError(error, "Could not delete the meeting link."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}
