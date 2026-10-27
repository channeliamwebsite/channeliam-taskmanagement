"use server";

import { refresh } from "next/cache";

import { NOT_PERMITTED, cleanText, dbError, fail, getActor, isUuid, ok, parseDate, type ActionResult } from "./shared";

export type MeetingRecordInput = {
  workspaceId: string;
  meetingLinkId: string;
  meetingDate: string;
  status: "SCHEDULED" | "HELD" | "CANCELLED";
  agenda?: string | null;
  notes?: string | null;
  decisions?: string | null;
  /** Existing tasks agreed as follow-up actions. */
  followUpTaskIds?: string[];
};

/** Deletes one meeting's record for one date; the meeting schedule is kept. */
export async function deleteMeetingRecord(meetingLinkId: string, meetingDate: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can record meetings.");
  if (!isUuid(meetingLinkId)) return fail("Invalid meeting.");
  const date = parseDate(meetingDate);
  if (!date) return fail("Enter a valid date.");

  const { data, error } = await actor.supabase
    .from("meeting_records")
    .delete()
    .eq("meeting_link_id", meetingLinkId)
    .eq("meeting_date", date)
    .select("id");
  if (error) return fail(dbError(error, "Could not delete the meeting record."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

/** Super admin records what happened at one meeting on one date (RLS: super admins of the workspace only). */
export async function saveMeetingRecord(input: MeetingRecordInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can record meetings.");
  if (!isUuid(input.workspaceId) || !isUuid(input.meetingLinkId)) return fail("Invalid meeting.");
  const date = parseDate(input.meetingDate);
  if (!date) return fail("Enter a valid date.");
  if (!["SCHEDULED", "HELD", "CANCELLED"].includes(input.status)) return fail("Choose a meeting status.");
  const ids = [...new Set(input.followUpTaskIds ?? [])];
  if (ids.length > 50 || !ids.every(isUuid)) return fail("Choose up to 50 follow-up tasks.");

  const { supabase } = actor;
  // The meeting must be one the caller can see in this workspace.
  const { data: meeting } = await supabase
    .from("meeting_links")
    .select("id")
    .eq("id", input.meetingLinkId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!meeting) return fail(NOT_PERMITTED);
  // Follow-up tasks must be existing tasks of this workspace.
  let followUps: string[] = [];
  if (ids.length) {
    const { data: tasks, error } = await supabase.from("tasks").select("id").eq("workspace_id", input.workspaceId).in("id", ids);
    if (error) return fail(dbError(error));
    const found = new Set(tasks.map((t) => t.id));
    if (found.size !== ids.length) return fail("Some follow-up tasks no longer exist.");
    followUps = ids;
  }

  const { error } = await supabase.from("meeting_records").upsert(
    {
      workspace_id: input.workspaceId,
      meeting_link_id: input.meetingLinkId,
      meeting_date: date,
      status: input.status,
      agenda: cleanText(input.agenda, 5000),
      notes: cleanText(input.notes, 10000),
      decisions: cleanText(input.decisions, 5000),
      follow_up_task_ids: followUps,
    },
    { onConflict: "meeting_link_id,meeting_date" },
  );
  if (error) return fail(dbError(error, "Could not save the meeting record."));
  refresh();
  return ok();
}
