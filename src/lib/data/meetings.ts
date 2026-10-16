import "server-only";

import { createClient } from "@/lib/supabase/server";

export type MeetingLink = {
  id: string;
  team: string | null;
  title: string;
  url: string;
  schedule: string | null;
  sortOrder: number;
  isActive: boolean;
  kind: "MORNING" | "EVENING" | "OTHER";
  /** HH:MM:SS (workspace local time) or null. */
  startsAt: string | null;
  /** One-off date, or null for a recurring daily meeting. */
  meetingDate: string | null;
};

/**
 * Meeting links the caller may see (RLS): the organisation-wide meeting(s),
 * their own team's meetings, and — for admins — every meeting in the workspace.
 */
export async function listMeetingLinks(workspaceId: string, opts: { activeOnly?: boolean } = {}): Promise<MeetingLink[]> {
  const supabase = await createClient();
  let query = supabase
    .from("meeting_links")
    .select("id, team, title, url, schedule, sort_order, is_active, kind, starts_at, meeting_date")
    .eq("workspace_id", workspaceId)
    .order("sort_order")
    .order("title");
  if (opts.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw new Error("Failed to load meeting links");
  return data.map((m) => ({
    id: m.id,
    team: m.team,
    title: m.title,
    url: m.url,
    schedule: m.schedule,
    sortOrder: m.sort_order,
    isActive: m.is_active,
    kind: (m.kind === "MORNING" || m.kind === "EVENING" ? m.kind : "OTHER") as MeetingLink["kind"],
    startsAt: m.starts_at,
    meetingDate: m.meeting_date,
  }));
}

const KIND_ORDER = { MORNING: 0, EVENING: 1, OTHER: 2 } as const;

/**
 * Today's meetings relevant to one person: organisation-wide plus their
 * team's, recurring or dated today; morning first, then by start time.
 */
export function meetingsForPerson(links: MeetingLink[], team: string | null, today?: string) {
  const mine = team?.trim().toLowerCase() ?? null;
  return links
    .filter((l) => l.isActive && (l.team === null || (mine !== null && l.team.trim().toLowerCase() === mine)))
    .filter((l) => !today || l.meetingDate === null || l.meetingDate === today)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.startsAt ?? "99").localeCompare(b.startsAt ?? "99") || a.sortOrder - b.sortOrder);
}
