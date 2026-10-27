import "server-only";

import { createClient } from "@/lib/supabase/server";

import { loadError } from "./errors";

export type MeetingRecordStatus = "SCHEDULED" | "HELD" | "CANCELLED";

export type MeetingRecord = {
  meetingLinkId: string;
  meetingDate: string;
  status: MeetingRecordStatus;
  agenda: string | null;
  notes: string | null;
  decisions: string | null;
  followUpTaskIds: string[];
  updatedAt: string;
};

/**
 * Meeting records (migration 013) for a date range; super admins only (RLS).
 * `available` is false while migration 013 is not applied yet, so the
 * dashboard can say so instead of failing.
 */
export async function listMeetingRecords(workspaceId: string, from: string, to: string): Promise<{ available: boolean; records: MeetingRecord[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meeting_records")
    .select("meeting_link_id, meeting_date, status, agenda, notes, decisions, follow_up_task_ids, updated_at")
    .eq("workspace_id", workspaceId)
    .gte("meeting_date", from)
    .lte("meeting_date", to);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return { available: false, records: [] };
    throw loadError("Failed to load meeting records", error);
  }
  return {
    available: true,
    records: data.map((r) => ({
      meetingLinkId: r.meeting_link_id,
      meetingDate: r.meeting_date,
      status: (r.status === "HELD" || r.status === "CANCELLED" ? r.status : "SCHEDULED") as MeetingRecordStatus,
      agenda: r.agenda,
      notes: r.notes,
      decisions: r.decisions,
      followUpTaskIds: r.follow_up_task_ids ?? [],
      updatedAt: r.updated_at,
    })),
  };
}
