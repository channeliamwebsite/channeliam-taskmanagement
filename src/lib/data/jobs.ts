import "server-only";

import { createClient } from "@/lib/supabase/server";

export type ScheduledJob = {
  name: string;
  schedule: string;
  active: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastMessage: string | null;
  runs24h: number;
  failures24h: number;
};

/**
 * Health of the app's pg_cron jobs (public.scheduled_job_health, migration 037;
 * super admins only). Empty when pg_cron is not installed; null when it could
 * not be read, so the page shows that instead of failing.
 */
export async function getScheduledJobs(): Promise<ScheduledJob[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("scheduled_job_health");
  if (error) {
    console.error("[data] Failed to load scheduled job health:", error.code ?? "no-code", error.message);
    return null;
  }
  return (data ?? []).map((r) => ({
    name: r.job_name,
    schedule: r.schedule,
    active: r.active,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastMessage: r.last_message,
    runs24h: r.runs_24h,
    failures24h: r.failures_24h,
  }));
}
