"use client";

import { AlertTriangle, Coffee, Loader2, LogIn, LogOut, Play } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { checkIn, checkOut, endBreak, startBreak } from "@/lib/actions/attendance";
import {
  expectedNetMinutes,
  formatDay,
  formatDuration,
  formatTime,
  workSummary,
  type AttendanceSession,
  type WorkPolicy,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";

/**
 * Check-in / break / check-out control with live totals. State comes from the
 * server on every render (so a refresh never loses it); the timer is display
 * only, aligned to the server clock, and uses the same calculation as the
 * server (workSummary), so a wrong device clock does not skew it.
 */
export function CheckInCard({
  workspaceId,
  workspaceName,
  timeZone,
  today,
  serverNow,
  todaySessions,
  openSession,
  openWorkspaceName,
  policy,
}: {
  workspaceId: string;
  workspaceName: string;
  timeZone: string;
  today: string;
  /** Server time when the page was rendered (ISO). */
  serverNow: string;
  /** Sessions of today's local date, with their breaks. */
  todaySessions: AttendanceSession[];
  /** The caller's open session, whatever its date. */
  openSession: AttendanceSession | null;
  openWorkspaceName: string | null;
  policy: WorkPolicy;
}) {
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"stale" | "checkout" | null>(null);
  const [now, setNow] = useState(() => Date.parse(serverNow));

  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now();
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [serverNow]);

  const stale = openSession !== null && openSession.workDate < today;
  const work = workSummary(todaySessions, policy, new Date(now));
  const onBreak = Boolean(openSession && !stale && work.onBreak);
  const checkedOutToday = !openSession && todaySessions.some((s) => s.checkOutAt);
  const firstIn = todaySessions.map((s) => s.checkInAt).sort()[0] ?? null;
  const lastOut = openSession ? null : (todaySessions.map((s) => s.checkOutAt).filter(Boolean).sort().at(-1) ?? null);
  const runningBreak = openSession?.breaks?.find((b) => !b.endedAt) ?? null;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "Something went wrong. Please try again.");
      setConfirm(null);
    });
  }

  const status = stale
    ? { label: "Missing check-out", tone: "text-amber-700 dark:text-amber-300" }
    : onBreak
      ? { label: "On break", tone: "text-violet-700 dark:text-violet-300" }
      : openSession
        ? { label: "Checked in", tone: "text-sky-700 dark:text-sky-300" }
        : checkedOutToday
          ? { label: "Checked out", tone: "text-emerald-700 dark:text-emerald-300" }
          : { label: "Not checked in", tone: "text-muted-foreground" };

  const spinner = <Loader2 className="animate-spin" aria-hidden="true" />;

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="attendance-status">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p id="attendance-status" className={cn("text-sm font-medium", status.tone)} aria-live="polite">
            {status.label}
            {onBreak && runningBreak ? <span className="text-muted-foreground"> · since {formatTime(runningBreak.startedAt, timeZone)}</span> : null}
            {openSession && !stale && !onBreak ? <span className="text-muted-foreground"> · since {formatTime(openSession.checkInAt, timeZone)}</span> : null}
          </p>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl" aria-live="off">
            {formatDuration(work.netMinutes)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Net working time today · target {formatDuration(expectedNetMinutes(policy))}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {stale ? (
              <Button size="lg" variant="outline" disabled={pending} onClick={() => setConfirm("stale")}>
                {pending ? spinner : <LogOut aria-hidden="true" />}
                Check out
              </Button>
            ) : openSession ? (
              <>
                {onBreak ? (
                  <Button size="lg" variant="secondary" disabled={pending} onClick={() => run(endBreak, "Break ended.")}>
                    {pending ? spinner : <Play aria-hidden="true" />}
                    End break
                  </Button>
                ) : (
                  <Button size="lg" variant="secondary" disabled={pending} onClick={() => run(startBreak, "Break started.")}>
                    {pending ? spinner : <Coffee aria-hidden="true" />}
                    Start break
                  </Button>
                )}
                <Button size="lg" disabled={pending} onClick={() => setConfirm("checkout")}>
                  {pending ? spinner : <LogOut aria-hidden="true" />}
                  Check out
                </Button>
              </>
            ) : checkedOutToday ? (
              <Button size="lg" variant="outline" disabled>
                Done for today
              </Button>
            ) : (
              <Button size="lg" disabled={pending} onClick={() => run(() => checkIn(workspaceId), "Checked in.")}>
                {pending ? spinner : <LogIn aria-hidden="true" />}
                Check in
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground sm:text-right">
            {openSession && openWorkspaceName && openSession.workspaceId !== workspaceId
              ? `Checked in to ${openWorkspaceName}`
              : checkedOutToday
                ? "One check-in per day. See you tomorrow."
                : `Workspace: ${workspaceName}`}
          </p>
        </div>
      </div>

      {stale ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            You didn&apos;t check out on {formatDay(openSession.workDate)} (checked in at {formatTime(openSession.checkInAt, timeZone)}).
            Check out to close that session before checking in again.
          </span>
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-5">
        <div>
          <dt className="text-xs text-muted-foreground">Check-in</dt>
          <dd className="font-medium tabular-nums">{formatTime(firstIn, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Check-out</dt>
          <dd className="font-medium tabular-nums">{formatTime(lastOut, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Breaks</dt>
          <dd className="font-medium tabular-nums">
            {formatDuration(work.breakMinutes)}
            <span className="text-xs font-normal text-muted-foreground"> / {formatDuration(policy.breakAllowanceMinutes)}</span>
          </dd>
          {work.excessBreakMinutes > 0 ? (
            <dd className="text-xs text-amber-700 dark:text-amber-300">{formatDuration(work.excessBreakMinutes)} over</dd>
          ) : null}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total elapsed</dt>
          <dd className="font-medium tabular-nums">{formatDuration(work.elapsedMinutes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Remaining</dt>
          <dd className="font-medium tabular-nums">{work.remainingMinutes ? formatDuration(work.remainingMinutes) : "Done"}</dd>
        </div>
      </dl>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm === "stale" ? "Close the missed session?" : "Check out for today?"}
        description={
          confirm === "stale" && stale
            ? `The session from ${formatDay(openSession.workDate)} will end now, so it will include all the time until now. Corrections will be available once attendance corrections are set up.`
            : `You can check in only once a day, so you won't be able to check in again today.${onBreak ? " Your running break ends now." : ""}`
        }
        confirmLabel="Check out now"
        pending={pending}
        onConfirm={() => run(checkOut, "Checked out.")}
      />
    </section>
  );
}
