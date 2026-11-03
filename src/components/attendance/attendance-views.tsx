import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DAY_STATUS_DOT,
  DAY_STATUS_LABELS,
  DAY_STATUS_STYLES,
  addMonths,
  formatDay,
  formatDuration,
  formatMonth,
  formatTime,
  monthGrid,
  breakMinutes,
  sessionMinutes,
  type AttendanceSession,
  type DayStatus,
  type DaySummary,
} from "@/lib/attendance";
import { cn } from "@/lib/utils";

/** Statuses that are known ahead of time (approved leave, holidays), shown on future dates too. */
const PLANNED = new Set<DayStatus>(["CL", "LWP", "WFH", "HOLIDAY", "WEEKLY_OFF"]);

const badge = "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset";

export function DayStatusBadge({ status, className }: { status: DayStatus; className?: string }) {
  return (
    <span className={cn(badge, DAY_STATUS_STYLES[status], className)}>
      <span className={cn("size-1.5 rounded-full", DAY_STATUS_DOT[status])} aria-hidden="true" />
      {DAY_STATUS_LABELS[status]}
    </span>
  );
}

/** This week, Monday to Sunday. Future days show no status. */
export function WeekList({ days, today, timeZone }: { days: DaySummary[]; today: string; timeZone: string }) {
  const total = days.reduce((sum, d) => sum + d.work.netMinutes, 0);
  return (
    <div>
      <ul className="divide-y">
        {days.map((d) => (
          <li key={d.date} className={cn("flex items-center gap-3 py-2 text-sm", d.date === today && "font-medium")}>
            <span className="w-24 shrink-0">{formatDay(d.date)}</span>
            <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums sm:block">
              {d.firstCheckIn ? `${formatTime(d.firstCheckIn, timeZone)} – ${formatTime(d.lastCheckOut, timeZone)}` : ""}
            </span>
            <span className="ml-auto w-16 shrink-0 text-right tabular-nums sm:ml-0">{d.work.netMinutes > 0 ? formatDuration(d.work.netMinutes) : "—"}</span>
            <span className="w-32 shrink-0 text-right">{d.date > today && !PLANNED.has(d.status) ? null : <DayStatusBadge status={d.status} />}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t pt-3 text-right text-sm text-muted-foreground">
        Net this week: <span className="font-medium text-foreground tabular-nums">{formatDuration(total)}</span>
      </p>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month calendar with a status per day; navigation via ?month=YYYY-MM. */
export function MonthCalendar({
  month,
  days,
  today,
}: {
  month: string;
  days: Map<string, DaySummary>;
  today: string;
}) {
  const grid = monthGrid(month);
  const link = (m: string) => `/attendance?month=${m}`;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link href={link(addMonths(month, -1))} className="rounded-md p-1.5 hover:bg-muted" aria-label="Previous month">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
        <p className="text-sm font-medium">{formatMonth(month)}</p>
        <Link href={link(addMonths(month, 1))} className="rounded-md p-1.5 hover:bg-muted" aria-label="Next month">
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label={formatMonth(month)}>
        {grid.flat().map((date, i) => {
          if (!date) return <span key={`pad-${i}`} />;
          const day = days.get(date);
          const status = date > today ? (day && PLANNED.has(day.status) ? day.status : null) : (day?.status ?? "NO_RECORD");
          const label = `${formatDay(date)}: ${status ? DAY_STATUS_LABELS[status] : day?.holiday ? `Holiday (${day.holiday})` : day?.leave ? `${DAY_STATUS_LABELS[day.leave]} (approved)` : "upcoming"}${day?.holiday && status === "HOLIDAY" ? ` · ${day.holiday}` : ""}${day && day.work.netMinutes > 0 ? `, ${formatDuration(day.work.netMinutes)} net` : ""}`;
          return (
            <div
              key={date}
              role="gridcell"
              aria-label={label}
              title={label}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-md text-xs tabular-nums",
                date === today ? "ring-2 ring-primary" : "bg-muted/40",
              )}
            >
              <span>{Number(date.slice(8))}</span>
              {status && status !== "NO_RECORD" ? (
                <span className={cn("mt-1 size-1.5 rounded-full", DAY_STATUS_DOT[status])} aria-hidden="true" />
              ) : null}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {(["PRESENT", "CHECKED_IN", "MISSING_CHECKOUT", "CL", "LWP", "WFH", "HOLIDAY"] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", DAY_STATUS_DOT[s])} aria-hidden="true" />
            {DAY_STATUS_LABELS[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every session in the month, newest first. */
export function HistoryTable({
  sessions,
  days,
  timeZone,
  workspaceNames,
}: {
  sessions: AttendanceSession[];
  days: Map<string, DaySummary>;
  timeZone: string;
  workspaceNames: Map<string, string>;
}) {
  if (sessions.length === 0) {
    return <EmptyState icon={CalendarClock} title="No attendance this month" description="Check-ins you record appear here." />;
  }
  const showWorkspace = new Set(sessions.map((s) => s.workspaceId)).size > 1;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Check-in</TableHead>
          <TableHead>Check-out</TableHead>
          <TableHead className="text-right">Breaks</TableHead>
          <TableHead className="text-right">Net working</TableHead>
          <TableHead>Status</TableHead>
          {showWorkspace ? <TableHead>Workspace</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((s) => {
          const status = days.get(s.workDate)?.status ?? "PRESENT";
          const missing = !s.checkOutAt && status === "MISSING_CHECKOUT";
          return (
            <TableRow key={s.id}>
              <TableCell className="whitespace-nowrap">{formatDay(s.workDate)}</TableCell>
              <TableCell className="tabular-nums">{formatTime(s.checkInAt, timeZone)}</TableCell>
              <TableCell className="tabular-nums">{s.checkOutAt ? formatTime(s.checkOutAt, timeZone) : missing ? "Missing" : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{s.checkOutAt ? formatDuration(breakMinutes(s)) : missing ? "—" : "…"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {s.checkOutAt ? formatDuration(sessionMinutes(s) - breakMinutes(s)) : missing ? "—" : "In progress"}
              </TableCell>
              <TableCell>
                <DayStatusBadge status={s.checkOutAt ? "PRESENT" : missing ? "MISSING_CHECKOUT" : "CHECKED_IN"} />
              </TableCell>
              {showWorkspace ? <TableCell className="text-muted-foreground">{workspaceNames.get(s.workspaceId) ?? "—"}</TableCell> : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
