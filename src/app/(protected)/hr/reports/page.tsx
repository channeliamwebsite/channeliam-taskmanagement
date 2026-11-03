import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Section } from "@/components/app/page-header";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatMonth } from "@/lib/attendance";
import { ROUTE_ROLES } from "@/lib/auth/roles";
import { buildMonthReport } from "@/lib/data/hr-month";
import { listEmployees } from "@/lib/data/hr-people";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";
import { resolveReportScope } from "@/lib/hr/report-scope";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Monthly reports" };

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, "0"),
  label: new Date(Date.UTC(2000, i, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
}));

export default async function MonthlyReportsPage({ searchParams }: PageProps<"/hr/reports">) {
  const { session } = await getPageContext(ROUTE_ROLES["/hr"]);
  const sp = await searchParams;
  const currentMonth = todayISO(new Date(), BUSINESS_TIMEZONE).slice(0, 7);
  const scope = resolveReportScope(
    { userId: session.user.id, role: session.profile.role },
    { month: sp.month, year: sp.year, employee: sp.employee, department: sp.department },
    currentMonth,
  );
  const [employees, report] = await Promise.all([
    listEmployees({ includeInactive: true }),
    buildMonthReport(scope.month, { userId: scope.userId, department: scope.department }),
  ]);
  const departments = [...new Set(employees.map((e) => e.department).filter(Boolean) as string[])].sort();
  const thisYear = Number(currentMonth.slice(0, 4));
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);

  const query = new URLSearchParams({ month: scope.month });
  if (scope.userId) query.set("employee", scope.userId);
  if (scope.department) query.set("department", scope.department);

  return (
    <>
      <PageHeader
        title="Monthly reports"
        description={`${formatMonth(scope.month)} · ${scope.userId ? "one employee" : scope.department ? scope.department : "all employees"}. Holidays and Sundays are never counted as absences.`}
        actions={
          <a
            href={`/attendance/reports/export?${query}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            download
          >
            <Download className="size-4" aria-hidden="true" />
            Download Excel
          </a>
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" aria-label="Report filters">
        <NativeSelect name="month" defaultValue={scope.month.slice(5)} aria-label="Month">
          {MONTHS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </NativeSelect>
        <NativeSelect name="year" defaultValue={scope.month.slice(0, 4)} aria-label="Year">
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </NativeSelect>
        <NativeSelect name="employee" defaultValue={scope.userId ?? ""} aria-label="Employee" className="w-full sm:w-56">
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.userId} value={e.userId}>
              {e.employeeCode} · {e.name}{e.isActive ? "" : " (deactivated)"}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="department" defaultValue={scope.department ?? ""} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </NativeSelect>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Apply</button>
      </form>
      <Section title={`Preview (${report.reports.length} employees)`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">Present</TableHead>
              <TableHead className="text-right">CL</TableHead>
              <TableHead className="text-right">LWP</TableHead>
              <TableHead className="text-right">WFH</TableHead>
              <TableHead className="text-right">Holidays</TableHead>
              <TableHead className="text-right">Weekly offs</TableHead>
              <TableHead className="text-right">Absent</TableHead>
              <TableHead className="text-right">Net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.reports.map(({ employee: e, totals: t }) => (
              <TableRow key={e.userId}>
                <TableCell className="font-mono text-xs">{e.employeeCode}</TableCell>
                <TableCell>
                  <Link href={`/hr/employees/${e.userId}?month=${scope.month}`} className="font-medium underline-offset-4 hover:underline">{e.name}</Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{e.department ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{t.present}</TableCell>
                <TableCell className="text-right tabular-nums">{t.cl}</TableCell>
                <TableCell className="text-right tabular-nums">{t.lwp}</TableCell>
                <TableCell className="text-right tabular-nums">{t.wfh}</TableCell>
                <TableCell className="text-right tabular-nums">{t.holidays}</TableCell>
                <TableCell className="text-right tabular-nums">{t.weeklyOffs}</TableCell>
                <TableCell className="text-right tabular-nums">{t.absent}</TableCell>
                <TableCell className="text-right tabular-nums">{formatDuration(t.netMinutes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
    </>
  );
}
