"use server";

import { refresh } from "next/cache";

import { dbError, fail, getActor, ok, type ActionResult } from "./shared";

const JOBS = new Set(["daily-task-reminders", "daily-morning-reports", "client-reports", "evening-report-reminders"]);

/** Super admins: run one of the app's idempotent scheduled jobs now (public.retry_scheduled_job, migration 037). */
export async function retryScheduledJob(name: string): Promise<ActionResult<{ processed: number }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can run scheduled jobs.");
  if (!JOBS.has(name)) return fail("Unknown scheduled job.");
  const { data, error } = await actor.supabase.rpc("retry_scheduled_job", { p_job: name });
  if (error) return fail(dbError(error, "The job could not be run."));
  refresh();
  return ok({ processed: data ?? 0 });
}
