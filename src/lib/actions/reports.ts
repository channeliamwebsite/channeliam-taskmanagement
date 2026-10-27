"use server";

import { refresh } from "next/cache";

import { getPermissions } from "@/lib/auth/roles";
import { summarizeDay } from "@/lib/data/daily-summary";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";

import { cleanText, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

const MONITOR_ONLY = "Super admins review daily reports; they do not submit them.";

export type DailyReportInput = {
  workspaceId: string;
  /** Optional; blank means not recorded. */
  totalHours?: number | string | null;
  accomplishments?: string | null;
  /** Reasons for incomplete work. */
  workRemaining?: string | null;
  blockers?: string | null;
  tomorrowPlan?: string | null;
};

/**
 * Creates or updates the caller's report for today (workspace timezone) via
 * public.submit_evening_report. The app chooses which of the caller's tasks the
 * report covers; counts, snapshot, date and timestamps come from the database.
 */
export async function saveDailyReport(input: DailyReportInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!getPermissions(actor.profile.role).submitDailyReports) return fail(MONITOR_ONLY);
  if (!isUuid(input.workspaceId)) return fail("Invalid workspace.");

  const { supabase, userId } = actor;
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, timezone")
    .eq("id", input.workspaceId)
    .maybeSingle();
  if (!workspace) return fail("Workspace not found.");

  let hours = 0;
  if (input.totalHours !== null && input.totalHours !== undefined && input.totalHours !== "") {
    hours = Number(input.totalHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) return fail("Hours must be between 0 and 24.");
  }

  const tz = workspace.timezone || BUSINESS_TIMEZONE;
  const today = todayISO(new Date(), tz);
  const day = await summarizeDay(workspace.id, userId, today, tz);
  const linked = [...new Set([...day.completed, ...day.notCompleted, ...day.blocked].map((t) => t.id))].slice(0, 100);

  // The database function sets the report date (workspace timezone), keeps the
  // first submission time, builds the task snapshot and the counts from the
  // tasks table, and ignores ids that are not the caller's own tasks.
  const { error } = await supabase.rpc("submit_evening_report", {
    p_workspace_id: workspace.id,
    p_total_hours: Math.round(hours * 100) / 100,
    p_accomplishments: cleanText(input.accomplishments, 10000) ?? undefined,
    p_work_remaining: cleanText(input.workRemaining, 10000) ?? undefined,
    p_blockers: cleanText(input.blockers, 10000) ?? undefined,
    p_tomorrow_plan: cleanText(input.tomorrowPlan, 10000) ?? undefined,
    p_linked_task_ids: linked,
  });
  if (error) return fail(dbError(error, "Could not save the report."));

  refresh();
  return ok();
}

/**
 * Morning plan for today (workspace timezone). The planned tasks are taken
 * from the database — today's workload including carried-forward and blocked
 * work — so employees only add notes. Stored on the same daily_reports row
 * the evening report later completes.
 */
export async function saveMorningPlan(workspaceId: string, notes: string | null): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!getPermissions(actor.profile.role).submitDailyReports) return fail(MONITOR_ONLY);
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");

  const { supabase, userId } = actor;
  const { data: workspace } = await supabase.from("workspaces").select("id, timezone").eq("id", workspaceId).maybeSingle();
  if (!workspace) return fail("Workspace not found.");

  const tz = workspace.timezone || BUSINESS_TIMEZONE;
  const today = todayISO(new Date(), tz);
  const day = await summarizeDay(workspace.id, userId, today, tz);
  // Same rules as the evening report: date, first submission time and task
  // ownership are decided by the database function.
  const { error } = await supabase.rpc("submit_morning_plan", {
    p_workspace_id: workspace.id,
    p_notes: cleanText(notes, 10000) ?? undefined,
    p_planned_task_ids: [...new Set([...day.notCompleted, ...day.blocked].map((t) => t.id))].slice(0, 100),
  });
  if (error) return fail(dbError(error, "Could not save the morning plan."));

  refresh();
  return ok();
}