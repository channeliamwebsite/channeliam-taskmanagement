// Monthly attendance figures for the HR dashboard and Excel export (phase 7).
// Pure: inputs are already loaded (and access-checked by RLS); this decides
// each day's status and the totals, using the same day rules as the
// employee calendar (summarizeDay) plus "absent".
import { addDaysISO, weekdayOf } from "../domain.ts";
import { summarizeDay, type AttendanceSession, type DayStatus, type WorkPolicy } from "../attendance.ts";
import type { LeaveType } from "./leave.ts";

export type ReportStatus = DayStatus | "ABSENT" | "NOT_JOINED" | "UPCOMING";

export const REPORT_CODES: Record<ReportStatus, string> = {
  PRESENT: "P",
  CHECKED_IN: "P",
  MISSING_CHECKOUT: "MC",
  NO_RECORD: "—",
  CL: "CL",
  LWP: "LWP",
  WFH: "WFH",
  HOLIDAY: "H",
  WEEKLY_OFF: "WO",
  ABSENT: "A",
  NOT_JOINED: "",
  UPCOMING: "",
};

export const REPORT_LABELS: Record<ReportStatus, string> = {
  PRESENT: "Present",
  CHECKED_IN: "Working",
  MISSING_CHECKOUT: "Missing check-out",
  NO_RECORD: "No record",
  CL: "Casual Leave",
  LWP: "Leave Without Pay",
  WFH: "Work From Home",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
  ABSENT: "Absent",
  NOT_JOINED: "Before joining",
  UPCOMING: "Upcoming",
};

export type ReportDay = {
  date: string;
  status: ReportStatus;
  checkIn: string | null;
  checkOut: string | null;
  breakMinutes: number;
  netMinutes: number;
  /** Approved leave on the date (also when the employee worked). */
  leave: LeaveType | null;
  holiday: string | null;
  /** An open break right now (only on a checked-in day). */
  onBreak: boolean;
};

export type ReportTotals = {
  present: number;
  cl: number;
  lwp: number;
  wfh: number;
  holidays: number;
  weeklyOffs: number;
  absent: number;
  missingCheckout: number;
  netMinutes: number;
  breakMinutes: number;
};

export function monthDates(first: string, last: string) {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

/**
 * One employee's month. `joined` is the first date the employee could be
 * absent (joining date, or the account's creation date when unknown).
 * Days after `today` are upcoming; today itself is never absent (the day is
 * not over).
 */
export function employeeMonth(input: {
  dates: string[];
  sessions: AttendanceSession[];
  leave: ReadonlyMap<string, LeaveType>;
  holidays: ReadonlyMap<string, string>;
  weeklyOffDays: readonly number[];
  policy: WorkPolicy;
  today: string;
  joined: string | null;
  now?: Date;
}): { days: ReportDay[]; totals: ReportTotals } {
  const ctx = { leave: input.leave, holidays: input.holidays, weeklyOffDays: input.weeklyOffDays };
  const totals: ReportTotals = { present: 0, cl: 0, lwp: 0, wfh: 0, holidays: 0, weeklyOffs: 0, absent: 0, missingCheckout: 0, netMinutes: 0, breakMinutes: 0 };
  const days = input.dates.map((date): ReportDay => {
    const s = summarizeDay(date, input.sessions, input.today, input.now, input.policy, ctx);
    let status: ReportStatus = s.status;
    if (input.joined && date < input.joined && s.sessions.length === 0) status = "NOT_JOINED";
    else if (status === "NO_RECORD") status = date < input.today ? "ABSENT" : "UPCOMING";
    // Approved future leave keeps its status for display; it is counted only once the day has come (below).
    const day: ReportDay = {
      date,
      status,
      checkIn: s.firstCheckIn,
      checkOut: s.lastCheckOut,
      breakMinutes: s.work.breakMinutes,
      netMinutes: s.work.netMinutes,
      leave: s.leave,
      holiday: s.holiday,
      onBreak: status === "CHECKED_IN" && s.work.onBreak,
    };
    const counts = date <= input.today;
    if (status === "PRESENT" || status === "CHECKED_IN") totals.present++;
    if (status === "MISSING_CHECKOUT") {
      totals.present++;
      totals.missingCheckout++;
    }
    if (counts && status === "CL") totals.cl++;
    if (counts && status === "LWP") totals.lwp++;
    // WFH counts whether or not the employee also checked in that day.
    if (counts && s.leave === "WFH" && status !== "HOLIDAY" && status !== "WEEKLY_OFF") totals.wfh++;
    if (status === "HOLIDAY") totals.holidays++;
    if (status === "WEEKLY_OFF") totals.weeklyOffs++;
    if (status === "ABSENT") totals.absent++;
    totals.netMinutes += day.netMinutes;
    totals.breakMinutes += day.breakMinutes;
    return day;
  });
  return { days, totals };
}

/** One employee's state on one date, for the super admin dashboard. */
export type DashboardStatus =
  | "WORKING"
  | "ON_BREAK"
  | "CHECKED_OUT"
  | "MISSING_CHECKOUT"
  | "WFH"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEKLY_OFF"
  | "ABSENT"
  | "NOT_CHECKED_IN"
  | "NOT_JOINED";

export const DASHBOARD_LABELS: Record<DashboardStatus, string> = {
  WORKING: "Working",
  ON_BREAK: "On break",
  CHECKED_OUT: "Checked out",
  MISSING_CHECKOUT: "Missing check-out",
  WFH: "Work from home",
  ON_LEAVE: "On leave",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
  ABSENT: "Absent",
  NOT_CHECKED_IN: "Not checked in",
  NOT_JOINED: "Not joined",
};

/**
 * Attendance first (an employee who checked in on a WFH day is working);
 * then approved leave; a working day without either is "not checked in"
 * today and "absent" once the day is over. Holidays and weekly offs are
 * never absences.
 */
export function dashboardStatus(day: ReportDay): DashboardStatus {
  switch (day.status) {
    case "CHECKED_IN":
      return day.onBreak ? "ON_BREAK" : "WORKING";
    case "PRESENT":
      return "CHECKED_OUT";
    case "MISSING_CHECKOUT":
      return "MISSING_CHECKOUT";
    case "WFH":
      return "WFH";
    case "CL":
    case "LWP":
      return "ON_LEAVE";
    case "HOLIDAY":
      return "HOLIDAY";
    case "WEEKLY_OFF":
      return "WEEKLY_OFF";
    case "ABSENT":
      return "ABSENT";
    case "NOT_JOINED":
      return "NOT_JOINED";
    default:
      return "NOT_CHECKED_IN";
  }
}

export type DashboardCounts = {
  active: number;
  present: number;
  working: number;
  onBreak: number;
  wfh: number;
  onLeave: number;
  absent: number;
  notCheckedIn: number;
};

/** Card figures: "present" is everyone who checked in on the date; WFH counts approved WFH whether or not they checked in. */
export function dashboardCounts(days: readonly ReportDay[]): DashboardCounts {
  const c: DashboardCounts = { active: days.length, present: 0, working: 0, onBreak: 0, wfh: 0, onLeave: 0, absent: 0, notCheckedIn: 0 };
  for (const d of days) {
    const s = dashboardStatus(d);
    if (d.checkIn) c.present++;
    if (s === "WORKING") c.working++;
    if (s === "ON_BREAK") c.onBreak++;
    if (d.leave === "WFH" && s !== "HOLIDAY" && s !== "WEEKLY_OFF") c.wfh++;
    if (s === "ON_LEAVE") c.onLeave++;
    if (s === "ABSENT") c.absent++;
    if (s === "NOT_CHECKED_IN") c.notCheckedIn++;
  }
  return c;
}

/** True for a working day in the policy (not a weekly off, not a holiday). */
export function isWorkingDay(date: string, weeklyOffDays: readonly number[], holidays: ReadonlyMap<string, string>) {
  return !weeklyOffDays.includes(weekdayOf(date)) && !holidays.has(date);
}

/** "8h 15m" style hours for spreadsheets: decimal hours rounded to 2 places. */
export function hours(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100;
}
