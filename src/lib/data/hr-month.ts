import "server-only";

import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";
import { addMonths, monthRange } from "@/lib/attendance";
import { employeeMonth, monthDates, type ReportDay, type ReportTotals } from "@/lib/hr/report";
import type { LeaveApplication } from "@/lib/hr/leave";

import { listEmployees, loadAttendance, type Employee } from "./hr-people";

export type EmployeeMonthReport = { employee: Employee; days: ReportDay[]; totals: ReportTotals; applications: LeaveApplication[] };

/** "YYYY-MM" if valid, else the current month (India time). */
export function parseReportMonth(value: unknown) {
  const today = todayISO(new Date(), BUSINESS_TIMEZONE);
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= addMonths(today.slice(0, 7), 1) ? value : today.slice(0, 7);
}

/**
 * Monthly report for employees the caller may see (RLS: everyone for a super
 * admin, only themselves otherwise). Filters narrow the set; they never widen it.
 */
export async function buildMonthReport(month: string, filter: ReportFilter = {}): Promise<{
  month: string;
  dates: string[];
  today: string;
  reports: EmployeeMonthReport[];
}> {
  const { first, last } = monthRange(month);
  return { month, ...(await buildRangeReport(first, last, filter)) };
}

type ReportFilter = { userId?: string | null; department?: string | null };

/** Same as buildMonthReport for any date range (the dashboard uses one day). */
export async function buildRangeReport(first: string, last: string, filter: ReportFilter = {}) {
  const today = todayISO(new Date(), BUSINESS_TIMEZONE);
  const dates = monthDates(first, last);
  let employees = await listEmployees({ includeInactive: true, userIds: filter.userId ? [filter.userId] : undefined });
  if (filter.department) employees = employees.filter((e) => (e.department ?? "") === filter.department);
  // Inactive employees only if they have records in the month (handled below by skipping empty ones).
  const data = await loadAttendance(employees.map((e) => e.userId), first, last);
  const reports = employees
    .filter((e) => e.isActive || data.sessionsByUser.has(e.userId) || data.applicationsByUser.has(e.userId))
    .map((employee) => {
      const { days, totals } = employeeMonth({
        dates,
        sessions: data.sessionsByUser.get(employee.userId) ?? [],
        leave: data.leaveByUser.get(employee.userId) ?? new Map(),
        holidays: data.holidays,
        weeklyOffDays: data.policy.weeklyOffDays,
        policy: data.policy,
        today,
        joined: employee.joiningDate ?? employee.createdAt.slice(0, 10),
      });
      return { employee, days, totals, applications: data.applicationsByUser.get(employee.userId) ?? [] };
    });
  return { dates, today, reports };
}
