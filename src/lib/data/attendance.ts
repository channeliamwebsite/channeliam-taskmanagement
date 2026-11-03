import "server-only";

import { createClient } from "@/lib/supabase/server";
import { DEFAULT_WORK_POLICY, type AttendanceBreak, type AttendanceSession, type WorkPolicy } from "@/lib/attendance";

import { loadError } from "./errors";

type SessionRow = {
  id: string;
  workspace_id: string;
  work_date: string;
  check_in_at: string;
  check_out_at: string | null;
};

function toSession(row: SessionRow, breaks: AttendanceBreak[]): AttendanceSession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workDate: row.work_date,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    breaks,
  };
}

const COLUMNS = "id, workspace_id, work_date, check_in_at, check_out_at";

/**
 * The caller's own sessions between two local dates (inclusive), across all
 * their workspaces, plus any session still open (whatever its date), each
 * with its breaks. RLS limits rows to the caller's own unless they are a
 * super admin, so the user filter is required here.
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

  const rows = new Map<string, SessionRow>();
  for (const row of [...(range.data ?? []), ...(open.data ?? [])]) rows.set(row.id, row);

  const breaksBySession = new Map<string, AttendanceBreak[]>();
  if (rows.size) {
    const { data, error } = await supabase
      .from("attendance_breaks")
      .select("id, session_id, started_at, ended_at")
      .eq("user_id", userId)
      .in("session_id", [...rows.keys()])
      .order("started_at");
    if (error) throw loadError("attendance breaks", error);
    for (const b of data ?? []) {
      const list = breaksBySession.get(b.session_id) ?? [];
      list.push({ id: b.id, sessionId: b.session_id, startedAt: b.started_at, endedAt: b.ended_at });
      breaksBySession.set(b.session_id, list);
    }
  }

  return [...rows.values()]
    .map((row) => toSession(row, breaksBySession.get(row.id) ?? []))
    .sort((a, b) => b.checkInAt.localeCompare(a.checkInAt));
}

/** The company working-hours policy (hr_settings, 033); the default if it cannot be read. */
export async function getWorkPolicy(): Promise<WorkPolicy & { weeklyOffDays: number[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("hr_settings").select("scheduled_minutes, break_allowance_minutes, weekly_off_days").maybeSingle();
  if (error) throw loadError("working-hours policy", error);
  if (!data) return { ...DEFAULT_WORK_POLICY, weeklyOffDays: [0] };
  return { scheduledMinutes: data.scheduled_minutes, breakAllowanceMinutes: data.break_allowance_minutes, weeklyOffDays: data.weekly_off_days };
}
