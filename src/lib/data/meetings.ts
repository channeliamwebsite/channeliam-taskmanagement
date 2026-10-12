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
};

/**
 * Meeting links the caller may see (RLS): the organisation-wide meeting(s),
 * their own team's meetings, and — for admins — every meeting in the workspace.
 */
export async function listMeetingLinks(workspaceId: string, opts: { activeOnly?: boolean } = {}): Promise<MeetingLink[]> {
  const supabase = await createClient();
  let query = supabase
    .from("meeting_links")
    .select("id, team, title, url, schedule, sort_order, is_active")
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
  }));
}

/** The meetings relevant to one person: organisation-wide plus their team's. */
export function meetingsForPerson(links: MeetingLink[], team: string | null) {
  const mine = team?.trim().toLowerCase() ?? null;
  return links.filter((l) => l.isActive && (l.team === null || (mine !== null && l.team.trim().toLowerCase() === mine)));
}
