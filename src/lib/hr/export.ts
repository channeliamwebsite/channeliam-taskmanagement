// Monthly attendance workbook (phase 7). Server-side only: imported by the
// export Route Handler, never by a client component. Inputs are already
// scoped by RLS and resolveReportScope; this only lays them out.
import ExcelJS from "exceljs";

import { formatTime } from "../attendance.ts";
import { LEAVE_LABELS, LEAVE_STATUS_LABELS, type LeaveApplication } from "./leave.ts";
import { REPORT_CODES, REPORT_LABELS, hours, type ReportDay, type ReportTotals } from "./report.ts";

export type ExportEmployee = {
  userId: string;
  employeeCode: string | null;
  name: string;
  email: string | null;
  department: string | null;
  designation: string | null;
  joiningDate: string | null;
  employmentStatus: string | null;
  employmentType: string | null;
};

export type ExportInput = {
  month: string;
  dates: string[];
  timeZone: string;
  reports: { employee: ExportEmployee; days: ReportDay[]; totals: ReportTotals; applications: LeaveApplication[] }[];
  /** CL for the report's year, per employee. */
  clBalances: ReadonlyMap<string, { allowance: number | null; approved: number; pending: number }>;
  /** Names for approvers (user id → name). */
  names: ReadonlyMap<string, string>;
};

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };

function header(sheet: ExcelJS.Worksheet, columns: { header: string; key: string; width: number }[]) {
  sheet.columns = columns;
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", wrapText: true };
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: columns[0].key === "code" ? 2 : 0 }];
}

const time = (value: string | null, tz: string) => (value ? formatTime(value, tz) : "");

export async function buildAttendanceWorkbook(input: ExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TaskManagement";
  wb.created = new Date();

  // 1. Monthly attendance: one row per employee, one column per date.
  const monthly = wb.addWorksheet("Monthly Attendance");
  header(monthly, [
    { header: "Employee ID", key: "code", width: 12 },
    { header: "Employee name", key: "name", width: 24 },
    { header: "Department", key: "department", width: 16 },
    { header: "Designation", key: "designation", width: 18 },
    ...input.dates.map((d) => ({ header: d.slice(8), key: d, width: 5 })),
    { header: "Present", key: "present", width: 9 },
    { header: "CL", key: "cl", width: 6 },
    { header: "LWP", key: "lwp", width: 6 },
    { header: "WFH", key: "wfh", width: 6 },
    { header: "Public holidays", key: "holidays", width: 9 },
    { header: "Weekly offs", key: "weeklyOffs", width: 9 },
    { header: "Absent", key: "absent", width: 8 },
    { header: "Net working hours", key: "net", width: 11 },
  ]);
  for (const r of input.reports) {
    const row: Record<string, string | number> = {
      code: r.employee.employeeCode ?? "",
      name: r.employee.name,
      department: r.employee.department ?? "",
      designation: r.employee.designation ?? "",
      present: r.totals.present,
      cl: r.totals.cl,
      lwp: r.totals.lwp,
      wfh: r.totals.wfh,
      holidays: r.totals.holidays,
      weeklyOffs: r.totals.weeklyOffs,
      absent: r.totals.absent,
      net: hours(r.totals.netMinutes),
    };
    for (const d of r.days) row[d.date] = REPORT_CODES[d.status];
    monthly.addRow(row);
  }
  monthly.addRow([]);
  monthly.addRow(["Codes: P present · MC missing check-out · CL casual leave · LWP leave without pay · WFH work from home · H holiday · WO weekly off · A absent"]);

  // 2. Daily details: one row per employee per date.
  const daily = wb.addWorksheet("Daily Attendance Details");
  header(daily, [
    { header: "Employee ID", key: "code", width: 12 },
    { header: "Employee name", key: "name", width: 24 },
    { header: "Date", key: "date", width: 12 },
    { header: "Check-in", key: "in", width: 10 },
    { header: "Check-out", key: "out", width: 10 },
    { header: "Break (hours)", key: "break", width: 10 },
    { header: "Net working (hours)", key: "net", width: 11 },
    { header: "Attendance status", key: "status", width: 20 },
  ]);
  for (const r of input.reports) {
    for (const d of r.days) {
      daily.addRow({
        code: r.employee.employeeCode ?? "",
        name: r.employee.name,
        date: d.date,
        in: time(d.checkIn, input.timeZone),
        out: time(d.checkOut, input.timeZone),
        break: d.checkIn ? hours(d.breakMinutes) : "",
        net: d.checkIn ? hours(d.netMinutes) : "",
        status: d.status === "HOLIDAY" && d.holiday ? `Holiday · ${d.holiday}` : REPORT_LABELS[d.status],
      });
    }
  }

  // 3. Leave applications overlapping the month.
  const leave = wb.addWorksheet("Leave Summary");
  header(leave, [
    { header: "Employee ID", key: "code", width: 12 },
    { header: "Employee", key: "name", width: 24 },
    { header: "Leave type", key: "type", width: 18 },
    { header: "From", key: "from", width: 12 },
    { header: "To", key: "to", width: 12 },
    { header: "Working days", key: "days", width: 9 },
    { header: "Application status", key: "status", width: 12 },
    { header: "Approver", key: "approver", width: 22 },
    { header: "Approval date", key: "decidedAt", width: 12 },
  ]);
  for (const r of input.reports) {
    for (const a of r.applications) {
      leave.addRow({
        code: r.employee.employeeCode ?? "",
        name: r.employee.name,
        type: LEAVE_LABELS[a.type],
        from: a.start,
        to: a.end,
        days: a.workingDays,
        status: LEAVE_STATUS_LABELS[a.status],
        approver: a.decidedBy ? (input.names.get(a.decidedBy) ?? "Super admin") : "",
        decidedAt: a.decidedAt ? a.decidedAt.slice(0, 10) : "",
      });
    }
  }

  // 4. One row per employee: details, CL for the year, month totals.
  const summary = wb.addWorksheet("Employee Summary");
  header(summary, [
    { header: "Employee ID", key: "code", width: 12 },
    { header: "Employee name", key: "name", width: 24 },
    { header: "Email", key: "email", width: 26 },
    { header: "Department", key: "department", width: 16 },
    { header: "Designation", key: "designation", width: 18 },
    { header: "Joining date", key: "joined", width: 12 },
    { header: "Employment status", key: "empStatus", width: 14 },
    { header: "Employment type", key: "empType", width: 12 },
    { header: "CL allowance (year)", key: "clAllowance", width: 11 },
    { header: "CL used (year)", key: "clUsed", width: 9 },
    { header: "CL pending (year)", key: "clPending", width: 9 },
    { header: "CL balance (year)", key: "clBalance", width: 9 },
    { header: "LWP days", key: "lwp", width: 8 },
    { header: "WFH days", key: "wfh", width: 8 },
    { header: "Present days", key: "present", width: 9 },
    { header: "Absent days", key: "absent", width: 9 },
    { header: "Missing check-outs", key: "mc", width: 10 },
    { header: "Holidays", key: "holidays", width: 9 },
    { header: "Weekly offs", key: "weeklyOffs", width: 9 },
    { header: "Net working hours", key: "net", width: 11 },
    { header: "Break hours", key: "break", width: 9 },
  ]);
  for (const r of input.reports) {
    const cl = input.clBalances.get(r.employee.userId);
    summary.addRow({
      code: r.employee.employeeCode ?? "",
      name: r.employee.name,
      email: r.employee.email ?? "",
      department: r.employee.department ?? "",
      designation: r.employee.designation ?? "",
      joined: r.employee.joiningDate ?? "",
      empStatus: r.employee.employmentStatus ?? "",
      empType: r.employee.employmentType ?? "",
      clAllowance: cl?.allowance ?? "",
      clUsed: cl?.approved ?? "",
      clPending: cl?.pending ?? "",
      clBalance: cl && cl.allowance !== null ? cl.allowance - cl.approved : "",
      lwp: r.totals.lwp,
      wfh: r.totals.wfh,
      present: r.totals.present,
      absent: r.totals.absent,
      mc: r.totals.missingCheckout,
      holidays: r.totals.holidays,
      weeklyOffs: r.totals.weeklyOffs,
      net: hours(r.totals.netMinutes),
      break: hours(r.totals.breakMinutes),
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
