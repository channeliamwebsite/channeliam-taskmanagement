import "server-only";

import type { ReportTimes, Tracking, TrackingRow } from "@/lib/daily-tracking";
import { fetchAllPages } from "@/lib/paginate";
import { createClient } from "@/lib/supabase/server";

import { loadError } from "./errors";

/**
 * Today's automatic daily report for the workspace (public.daily_tracking):
 * the morning snapshot compared with live task data. Super admins and admins
 * get every member; others only themselves (enforced in the database).
 */
export async function loadDailyTracking(
  workspaceId: string,
  today: string,
): Promise<{ rows: TrackingRow[]; reports: ReportTimes[] }> {
  const supabase = await createClient();
  const [tracking, reports] = await Promise.all([
    // One row per person and task can exceed the API's per-response cap, so
    // read it in pages (ordered by the row key, user + task, for stable pages).
    fetchAllPages(async (from, to) => {
      const { data, error } = await supabase
        .rpc("daily_tracking", { p_workspace_id: workspaceId })
        .order("user_id")
        .order("task_id")
        .range(from, to);
      if (error) throw loadError("Failed to load daily tracking", error);
      return data;
    }),
    // Timestamps for everyone, including people whose morning report has no tasks
    // (RLS applies; at most one row per member).
    supabase
      .from("daily_reports")
      .select("user_id, morning_generated_at, morning_submitted_at, evening_submitted_at, blockers, work_remaining")
      .eq("workspace_id", workspaceId)
      .eq("report_date", today),
  ]);
  if (reports.error) throw loadError("Failed to load daily reports", reports.error);
  return {
    reports: reports.data.map((r) => ({
      userId: r.user_id,
      morningGeneratedAt: r.morning_generated_at,
      morningSubmittedAt: r.morning_submitted_at,
      eveningSubmittedAt: r.evening_submitted_at,
      blockers: r.blockers,
      workRemaining: r.work_remaining,
    })),
    rows: tracking.map((r) => ({
    userId: r.user_id,
    taskId: r.task_id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    projectName: r.project_name,
    clientName: r.client_name,
    dueDate: r.due_date,
    assignedAt: r.assigned_at,
    morningStatus: r.morning_status,
    tracking: r.tracking as Tracking,
    morningGeneratedAt: r.morning_generated_at,
    eveningSubmittedAt: r.evening_submitted_at,
    })),
  };
}
