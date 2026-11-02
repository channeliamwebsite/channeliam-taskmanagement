import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/page-header";
import { formatMonth } from "@/lib/attendance";
import { formatDate, formatDateTime } from "@/lib/domain";
import { formatReportHours, historyNavigation, type HistoryEntry } from "@/lib/report-history";
import { cn } from "@/lib/utils";

const navLink = "inline-flex h-9 items-center gap-1 rounded-lg border px-2.5 text-sm hover:bg-muted";

/** The signed-in person's own reports for one month, newest first. */
export function ReportHistoryList({ month, today, entries }: { month: string; today: string; entries: HistoryEntry[] }) {
  const link = (m: string) => `/reports?view=history&month=${m}`;
  const { previous, next } = historyNavigation(month, today);
  const currentMonth = today.slice(0, 7);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <nav className="flex items-center gap-2" aria-label="Month">
          <Link href={link(previous)} className={navLink}>
            <ChevronLeft className="size-4" aria-hidden="true" /> <span className="sr-only sm:not-sr-only">Previous</span>
          </Link>
          <h2 className="min-w-36 text-center text-sm font-medium">{formatMonth(month)}</h2>
          {next === null ? (
            <span className={cn(navLink, "pointer-events-none opacity-40")} aria-disabled="true">
              <span className="sr-only sm:not-sr-only">Next</span> <ChevronRight className="size-4" aria-hidden="true" />
            </span>
          ) : (
            <Link href={link(next)} className={navLink}>
              <span className="sr-only sm:not-sr-only">Next</span> <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </nav>
        <form action="/reports" className="flex items-end gap-2">
          <input type="hidden" name="view" value="history" />
          <label className="grid gap-1 text-xs text-muted-foreground">
            Go to month
            <input
              type="month"
              name="month"
              defaultValue={month}
              max={currentMonth}
              className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground"
            />
          </label>
          <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">
            Show
          </button>
        </form>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={FileText} title={`No reports in ${formatMonth(month)}`} description="Reports you submit appear here, month by month." />
      ) : (
        <ul className="grid gap-3">
          {entries.map((e) => (
            <li key={e.id} className="rounded-xl border bg-card p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-medium">{formatDate(e.date)}</p>
                {e.totalHours > 0 ? <span className="text-xs text-muted-foreground tabular-nums">{formatReportHours(e.totalHours)}</span> : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Morning plan: {e.morningSubmittedAt ? `submitted ${formatDateTime(e.morningSubmittedAt)}` : "not submitted"} · Evening report:{" "}
                {e.eveningSubmittedAt ? `submitted ${formatDateTime(e.eveningSubmittedAt)}` : "not submitted"}
                {e.updatedAt ? ` · last updated ${formatDateTime(e.updatedAt)}` : ""}
              </p>
              {e.counts ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {e.counts.completed} completed · {e.counts.notCompleted} not completed · {e.counts.blocked} blocked
                </p>
              ) : null}
              {e.sections.map((s) => (
                <div key={s.label} className="mt-2">
                  <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                  <p className="whitespace-pre-wrap break-words">{s.text}</p>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
