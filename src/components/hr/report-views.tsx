import { CalendarOff } from "lucide-react";

import { EmptyState } from "@/components/app/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDay, formatDuration, formatTime } from "@/lib/attendance";
import { LEAVE_LABELS, formatDateRange, type LeaveApplication } from "@/lib/hr/leave";
import { REPORT_LABELS, type ReportDay, type ReportTotals } from "@/lib/hr/report";
import { cn } from "@/lib/utils";

import { LeaveStatusBadge } from "./leave-components";

const TONES: Partial<Record<ReportDay["status"], string>> = {
  PRESENT: "text-emerald-700 dark:text-emerald-300",
  CHECKED_IN: "text-sky-700 dark:text-sky-300",
  MISSING_CHECKOUT: "text-amber-700 dark:text-amber-300",
  ABSENT: "text-red-700 dark:text-red-300",
  CL: "text-indigo-700 dark:text-indigo-300",
  LWP: "text-rose-700 dark:text-rose-300",
  WFH: "text-teal-700 dark:text-teal-300",
  HOLIDAY: "text-fuchsia-700 dark:text-fuchsia-300",
};

export function TotalsGrid({ totals }: { totals: ReportTotals }) {
  const items: [string, string][] = [
    ["Present", String(totals.present)],
    ["Casual Leave", String(totals.cl)],
    ["Leave Without Pay", String(totals.lwp)],
    ["Work From Home", String(totals.wfh)],
    ["Holidays", String(totals.holidays)],
    ["Weekly offs", String(totals.weeklyOffs)],
    ["Absent", String(totals.absent)],
    ["Net working", formatDuration(totals.netMinutes)],
    ["Breaks", formatDuration(totals.breakMinutes)],
  ];
  return (
    <dl className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DayTable({ days, timeZone }: { days: ReportDay[]; timeZone: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Check-in</TableHead>
          <TableHead>Check-out</TableHead>
          <TableHead className="text-right">Breaks</TableHead>
          <TableHead className="text-right">Net working</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {days.map((d) => (
          <TableRow key={d.date}>
            <TableCell className="whitespace-nowrap">{formatDay(d.date)}</TableCell>
            <TableCell className={cn("whitespace-nowrap font-medium", TONES[d.status])}>
              {REPORT_LABELS[d.status]}
              {d.holiday && d.status === "HOLIDAY" ? <span className="font-normal text-muted-foreground"> · {d.holiday}</span> : null}
            </TableCell>
            <TableCell className="tabular-nums">{d.checkIn ? formatTime(d.checkIn, timeZone) : "—"}</TableCell>
            <TableCell className="tabular-nums">{d.checkOut ? formatTime(d.checkOut, timeZone) : "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{d.checkIn ? formatDuration(d.breakMinutes) : "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{d.checkIn ? formatDuration(d.netMinutes) : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function LeaveHistoryTable({ applications }: { applications: LeaveApplication[] }) {
  if (!applications.length) return <EmptyState icon={CalendarOff} title="No leave applications" description="Nothing in this period." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Dates</TableHead>
          <TableHead className="text-right">Days</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {applications.map((a) => (
          <TableRow key={a.id}>
            <TableCell className="whitespace-nowrap">{LEAVE_LABELS[a.type]}</TableCell>
            <TableCell className="whitespace-nowrap tabular-nums">{formatDateRange(a.start, a.end)}</TableCell>
            <TableCell className="text-right tabular-nums">{a.workingDays}</TableCell>
            <TableCell className="max-w-64 truncate" title={a.reason}>{a.reason}</TableCell>
            <TableCell><LeaveStatusBadge status={a.status} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
