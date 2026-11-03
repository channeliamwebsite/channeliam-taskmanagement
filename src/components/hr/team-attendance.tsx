"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/app/page-header";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatTime } from "@/lib/attendance";
import { DASHBOARD_LABELS, type DashboardStatus } from "@/lib/hr/report";
import { cn } from "@/lib/utils";

export type TeamRow = {
  userId: string;
  employeeCode: string | null;
  name: string;
  department: string | null;
  designation: string | null;
  status: DashboardStatus;
  checkIn: string | null;
  checkOut: string | null;
  breakMinutes: number;
  netMinutes: number;
};

const TONES: Partial<Record<DashboardStatus, string>> = {
  WORKING: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  ON_BREAK: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  CHECKED_OUT: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  MISSING_CHECKOUT: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  WFH: "bg-teal-500/10 text-teal-700 dark:text-teal-300",
  ON_LEAVE: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  HOLIDAY: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  ABSENT: "bg-red-500/10 text-red-700 dark:text-red-300",
};

/** Team attendance for one date: search and filters run in the browser over rows the server already scoped. */
export function TeamAttendanceTable({ rows, timeZone, month }: { rows: TeamRow[]; timeZone: string; month: string }) {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState<DashboardStatus | "">("");
  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean) as string[])].sort(), [rows]);
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))], [rows]);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!department || r.department === department) &&
      (!status || r.status === status) &&
      (!needle || [r.name, r.employeeCode, r.designation].some((v) => v?.toLowerCase().includes(needle))),
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2" role="search">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or ID…" className="h-9 w-full sm:w-56" aria-label="Search employees" />
        <NativeSelect value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as DashboardStatus | "")} aria-label="Status">
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{DASHBOARD_LABELS[s]}</option>
          ))}
        </NativeSelect>
        <span className="text-xs text-muted-foreground">{shown.length} of {rows.length}</span>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={Users} title="No employees match" description="Change the search or filters." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Designation</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead className="text-right">Break</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.userId}>
                <TableCell className="font-mono text-xs">{r.employeeCode}</TableCell>
                <TableCell>
                  <Link href={`/hr/employees/${r.userId}?month=${month}`} className="font-medium underline-offset-4 hover:underline">
                    {r.name}
                  </Link>
                  {r.department ? <span className="block text-xs text-muted-foreground">{r.department}</span> : null}
                </TableCell>
                <TableCell className="text-muted-foreground">{r.designation ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{r.checkIn ? formatTime(r.checkIn, timeZone) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.checkIn ? formatDuration(r.breakMinutes) : "—"}</TableCell>
                <TableCell className="tabular-nums">{r.checkOut ? formatTime(r.checkOut, timeZone) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.checkIn ? formatDuration(r.netMinutes) : "—"}</TableCell>
                <TableCell>
                  <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[r.status] ?? "bg-muted text-muted-foreground")}>
                    {DASHBOARD_LABELS[r.status]}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
