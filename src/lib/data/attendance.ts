import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AttendanceSession } from "@/lib/attendance";

import { loadError } from "./errors";

type SessionRow = {
  id: string;
  workspace_id: string;
  work_date: string;
  check_in_at: string;
  check_out_at: string | null;
};

function toSession(row: SessionRow): AttendanceSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workDate: row.work_date,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
  };
}

const COLUMNS = "id, workspace_id, work_date, check_in_at, check_out_at";

/**
 * The caller's own sessions between two local dates (inclusive), across all
 * their workspaces, plus any session still open (whatever its date). RLS
 * limits rows to the caller's own unless they are a super admin, so the
 * user filter is required here.
 */
export async function listMyAttendance(userId: string, from: string, to: string): Promise<AttendanceSession[]> {
  const supabase = await createClient();
  const [range, open] = await Promise.all([
    supabase
      .from("attendance_sessions")
      .select(COLUMNS)
      .eq("user_id", userId)
      .gte("work_date", from)
      .lte("work_date", to)
      .order("check_in_at", { ascending: false }),
    supabase.from("attendance_sessions").select(COLUMNS).eq("user_id", userId).is("check_out_at", null),
  ]);
  if (range.error) throw loadError("attendance", range.error);
  if (open.error) throw loadError("attendance", open.error);

  const byId = new Map<string, AttendanceSession>();
  for (const row of [...(range.data ?? []), ...(open.data ?? [])]) byId.set(row.id, toSession(row));
  return [...byId.values()].sort((a, b) => b.checkInAt.localeCompare(a.checkInAt));
}
