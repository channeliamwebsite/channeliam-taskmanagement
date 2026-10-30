"use client";

import { AlertTriangle, Loader2, LogIn, LogOut } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { checkIn, checkOut } from "@/lib/actions/attendance";
import { formatClock, formatDay, formatDuration, formatTime, type AttendanceSession } from "@/lib/attendance";
import { cn } from "@/lib/utils";

/**
 * Check-in / check-out control with a live timer. State comes from the server
 * on every render (so a refresh never loses it); the timer is display only and
 * is aligned to the server clock, so a wrong device clock does not skew it.
 */
export function CheckInCard({
  workspaceId,
  workspaceName,
  timeZone,
  today,
  serverNow,
  openSession,
  openWorkspaceName,
  closedSecondsToday,
  firstCheckInToday,
  lastCheckOutToday,
}: {
  workspaceId: string;
  workspaceName: string;
  timeZone: string;
  today: string;
  /** Server time when the page was rendered (ISO). */
  serverNow: string;
  openSession: AttendanceSession | null;
  openWorkspaceName: string | null;
  /** Seconds of today's sessions that are already closed. */
  closedSecondsToday: number;
  firstCheckInToday: string | null;
  lastCheckOutToday: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [confirmStale, setConfirmStale] = useState(false);
  const [now, setNow] = useState(() => Date.parse(serverNow));

  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now();
    const id = window.setInterval(() => setNow(Date.now() + offset), 1000);
    return () => window.clearInterval(id);
  }, [serverNow]);

  const stale = openSession !== null && openSession.workDate < today;
  const openSeconds = openSession && !stale ? Math.max(0, (now - Date.parse(openSession.checkInAt)) / 1000) : 0;
  const totalSeconds = closedSecondsToday + openSeconds;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(success);
      else toast.error(result.error ?? "Something went wrong. Please try again.");
      setConfirmStale(false);
    });
  }

  const status = openSession
    ? stale
      ? { label: "Missing check-out", tone: "text-amber-700 dark:text-amber-300" }
      : { label: "Checked in", tone: "text-sky-700 dark:text-sky-300" }
    : { label: lastCheckOutToday ? "Checked out" : "Not checked in", tone: "text-muted-foreground" };

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="attendance-status">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p id="attendance-status" className={cn("text-sm font-medium", status.tone)}>
            {status.label}
            {openSession && !stale ? <span className="text-muted-foreground"> · since {formatTime(openSession.checkInAt, timeZone)}</span> : null}
          </p>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl" aria-live="off">
            {formatClock(totalSeconds)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Worked today · {formatDuration(totalSeconds / 60)}</p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {openSession ? (
            <Button
              size="lg"
              variant={stale ? "outline" : "default"}
              disabled={pending}
              onClick={() => (stale ? setConfirmStale(true) : run(checkOut, "Checked out."))}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
              Check out
            </Button>
          ) : (
            <Button size="lg" disabled={pending} onClick={() => run(() => checkIn(workspaceId), "Checked in.")}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
              Check in
            </Button>
          )}
          <p className="text-xs text-muted-foreground sm:text-right">
            {openSession && openWorkspaceName && openSession.workspaceId !== workspaceId
              ? `Checked in to ${openWorkspaceName}`
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

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">First check-in</dt>
          <dd className="font-medium tabular-nums">{formatTime(firstCheckInToday, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last check-out</dt>
          <dd className="font-medium tabular-nums">{formatTime(lastCheckOutToday, timeZone)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total today</dt>
          <dd className="font-medium tabular-nums">{formatDuration(totalSeconds / 60)}</dd>
        </div>
      </dl>

      <ConfirmDialog
        open={confirmStale}
        onOpenChange={setConfirmStale}
        title="Close the missed session?"
        description={
          stale
            ? `The session from ${formatDay(openSession.workDate)} will end now, so it will include all the time until now. Corrections will be available once attendance corrections are set up.`
            : ""
        }
        confirmLabel="Check out now"
        pending={pending}
        onConfirm={() => run(checkOut, "Checked out.")}
      />
    </section>
  );
}
