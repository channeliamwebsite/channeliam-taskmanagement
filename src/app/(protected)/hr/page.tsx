import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Section } from "@/components/app/page-header";
import { TeamAttendanceTable, type TeamRow } from "@/components/hr/team-attendance";
import { formatDay } from "@/lib/attendance";
import { ROUTE_ROLES } from "@/lib/auth/roles";
import { buildRangeReport } from "@/lib/data/hr-month";
import { BUSINESS_TIMEZONE, addDaysISO, todayISO } from "@/lib/domain";
import { isIsoDate } from "@/lib/hr/leave";
import { dashboardCounts, dashboardStatus } from "@/lib/hr/report";

import { getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Team attendance" };

export default async function HrDashboardPage({ searchParams }: PageProps<"/hr">) {
  // Super admins only; RLS also limits other roles to their own rows.
  await getPageContext(ROUTE_ROLES["/hr"]);
  const sp = await searchParams;
  const today = todayISO(new Date(), BUSINESS_TIMEZONE);
  const date = isIsoDate(sp.date) && sp.date <= today ? sp.date : today;

  const { reports } = await buildRangeReport(date, date);
  const active = reports.filter((r) => r.employee.isActive);
  const days = active.map((r) => r.days[0]);
  const counts = dashboardCounts(days);
  const rows: TeamRow[] = active.map((r) => ({
    userId: r.employee.userId,
    employeeCode: r.employee.employeeCode,
    name: r.employee.name,
    department: r.employee.department,
    designation: r.employee.designation,
    status: dashboardStatus(r.days[0]),
    checkIn: r.days[0].checkIn,
    checkOut: r.days[0].checkOut,
    breakMinutes: r.days[0].breakMinutes,
    netMinutes: r.days[0].netMinutes,
  }));

  const cards: [string, number][] = [
    ["Active employees", counts.active],
    ["Present", counts.present],
    ["Working", counts.working],
    ["On break", counts.onBreak],
    ["Work from home", counts.wfh],
    ["Approved leave", counts.onLeave],
    ["Absent", counts.absent],
    ["Not checked in", counts.notCheckedIn],
  ];

  return (
    <>
      <PageHeader
        title="Team attendance"
        description={date === today ? `Today · ${formatDay(date)}` : formatDay(date)}
        actions={
          <form className="flex items-center gap-2">
            <Link href={`/hr?date=${addDaysISO(date, -1)}`} className="rounded-md border px-2 py-1.5 text-sm hover:bg-muted" aria-label="Previous day">←</Link>
            <input type="date" name="date" defaultValue={date} max={today} className="h-9 rounded-lg border bg-background px-2 text-sm" aria-label="Date" />
            <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Go</button>
            {date < today ? (
              <Link href="/hr" className="rounded-md border px-2 py-1.5 text-sm hover:bg-muted">Today</Link>
            ) : null}
          </form>
        }
      />
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <Section title="Employees">
        <TeamAttendanceTable rows={rows} timeZone={BUSINESS_TIMEZONE} month={date.slice(0, 7)} />
      </Section>
    </>
  );
}
