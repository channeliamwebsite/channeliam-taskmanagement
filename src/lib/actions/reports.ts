"use server";

import { refresh } from "next/cache";

import { summarizeDay } from "@/lib/data/daily-summary";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";

import { cleanText, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

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
 * Creates or updates the caller's report for today (workspace timezone).
 * Task counts and linked tasks are derived from real task data on the server;
 * only the written parts and optional hours come from the user.
 */
export async function saveDailyReport(input: DailyReportInput): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
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

  const fields = {
    tasks_completed: day.completed.length,
    // Stores "not completed from today's workload" (derived).
    tasks_in_progress: day.notCompleted.length,
    tasks_blocked: day.blocked.length,
    total_hours: Math.round(hours * 100) / 100,
    accomplishments: cleanText(input.accomplishments, 10000),
    work_remaining: cleanText(input.workRemaining, 10000),
    blockers: cleanText(input.blockers, 10000),
    tomorrow_plan: cleanText(input.tomorrowPlan, 10000),
    linked_task_ids: linked,
    evening_submitted_at: new Date().toISOString(),
  };

  const { data: existing, error: loadError } = await supabase
    .from("daily_reports")
    .select("id")
    .eq("user_id", userId)
    .eq("workspace_id", workspace.id)
    .eq("report_date", today)
    .maybeSingle();
  if (loadError) return fail(dbError(loadError));

  const { error } = existing
    ? await supabase.from("daily_reports").update(fields).eq("id", existing.id)
    : await supabase
        .from("daily_reports")
        .insert({ ...fields, user_id: userId, workspace_id: workspace.id, report_date: today });
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
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");

  const { supabase, userId } = actor;
  const { data: workspace } = await supabase.from("workspaces").select("id, timezone").eq("id", workspaceId).maybeSingle();
  if (!workspace) return fail("Workspace not found.");

  const tz = workspace.timezone || BUSINESS_TIMEZONE;
  const today = todayISO(new Date(), tz);
  const day = await summarizeDay(workspace.id, userId, today, tz);
  const fields = {
    morning_plan: cleanText(notes, 10000),
    planned_task_ids: [...new Set([...day.notCompleted, ...day.blocked].map((t) => t.id))].slice(0, 100),
    morning_submitted_at: new Date().toISOString(),
  };

  const { data: existing, error: loadError } = await supabase
    .from("daily_reports")
    .select("id")
    .eq("user_id", userId)
    .eq("workspace_id", workspace.id)
    .eq("report_date", today)
    .maybeSingle();
  if (loadError) return fail(dbError(loadError));

  const { error } = existing
    ? await supabase.from("daily_reports").update(fields).eq("id", existing.id)
    : await supabase.from("daily_reports").insert({ ...fields, user_id: userId, workspace_id: workspace.id, report_date: today });
  if (error) return fail(dbError(error, "Could not save the morning plan."));

  refresh();
  return ok();
}