"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { retryScheduledJob } from "@/lib/actions/jobs";
import type { ScheduledJob } from "@/lib/data/jobs";
import { formatDateTime } from "@/lib/domain";

const LABELS: Record<string, string> = {
  "daily-task-reminders": "Daily task reminders",
  "daily-morning-reports": "Automatic morning reports",
  "client-reports": "Client reports",
  "evening-report-reminders": "Evening report reminders",
};

/** Super admins: last run and failures of the scheduled jobs, with a safe "Run now". */
export function ScheduledJobs({ jobs }: { jobs: ScheduledJob[] | null }) {
  const [pending, startTransition] = useTransition();
  if (jobs === null) return <p className="text-sm text-destructive">Scheduled job status could not be loaded.</p>;
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground">No scheduled jobs found (pg_cron is not installed on this database).</p>;
  }
  return (
    <ul className="grid gap-3">
      {jobs.map((j) => {
        const failing = j.lastStatus === "failed" || j.failures24h > 0;
        return (
          <li key={j.name} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
            <div className="grid gap-0.5 text-sm">
              <span className="font-medium">{LABELS[j.name] ?? j.name}</span>
              <span className={failing ? "text-destructive" : "text-muted-foreground"}>
                {j.lastRunAt ? `Last run ${formatDateTime(j.lastRunAt)} · ${j.lastStatus ?? "unknown"}` : "Not run yet"}
                {` · ${j.failures24h} of ${j.runs24h} runs failed in 24 h`}
                {j.active ? "" : " · paused"}
              </span>
              {failing && j.lastMessage ? <span className="text-xs text-muted-foreground">{j.lastMessage}</span> : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await retryScheduledJob(j.name);
                  if (r.ok) toast.success(`${LABELS[j.name] ?? j.name}: done (${r.data.processed} processed)`);
                  else toast.error(r.error);
                })
              }
            >
              Run now
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
