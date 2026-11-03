// Attendance calculations shared by server and client code. Pure functions:
// stored check-in/check-out times are the input; day classifications are
// derived here and never stored. Client-safe.

import { BUSINESS_TIMEZONE, addDaysISO, weekdayOf } from "./domain.ts";

export type AttendanceBreak = {
  id: string;
  sessionId: string;
  startedAt: string;
  /** null = still on break. */
  endedAt: string | null;
};

export type AttendanceSession = {
  id: string;
  workspaceId: string;
  /** Local date of the check-in (workspace timezone). */
  workDate: string;
  checkInAt: string;
  checkOutAt: string | null;
  /** Breaks taken during this session (033). */
  breaks?: AttendanceBreak[];
};

/** Company working-hours policy (hr_settings, 033). */
export type WorkPolicy = {
  /** Scheduled day including the break allowance (540 = 9 h). */
  scheduledMinutes: number;
  /** Break time included in the scheduled day (45). */
  breakAllowanceMinutes: number;
};

export const DEFAULT_WORK_POLICY: WorkPolicy = { scheduledMinutes: 540, breakAllowanceMinutes: 45 };

/** Net working minutes expected per day (540 - 45 = 495 = 8 h 15 m). */
export function expectedNetMinutes(policy: WorkPolicy) {
  return Math.max(0, policy.scheduledMinutes - policy.breakAllowanceMinutes);
}

function spanMinutes(start: string, end: string | null, now: Date) {
  const a = Date.parse(start);
  const b = end ? Date.parse(end) : now.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return (b - a) / 60000;
}

/**
 * Break minutes inside a session. A running break counts up to `now`, but no
 * break counts beyond the session's own end (or `now` while it is open), so
 * bad data can never make breaks longer than the time worked.
 */
export function breakMinutes(session: Pick<AttendanceSession, "checkInAt" | "checkOutAt" | "breaks">, now: Date = new Date()) {
  const sessionEnd = session.checkOutAt ? Date.parse(session.checkOutAt) : now.getTime();
  const sessionStart = Date.parse(session.checkInAt);
  let total = 0;
  for (const b of session.breaks ?? []) {
    const start = Math.max(Date.parse(b.startedAt), sessionStart);
    const end = Math.min(b.endedAt ? Date.parse(b.endedAt) : now.getTime(), sessionEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) total += (end - start) / 60000;
  }
  return Math.floor(Math.min(total, spanMinutes(session.checkInAt, session.checkOutAt, now)));
}

export type WorkSummary = {
  /** Check-in to check-out (or now), all counted sessions. */
  elapsedMinutes: number;
  breakMinutes: number;
  /** Elapsed minus breaks. */
  netMinutes: number;
  /** Break time beyond the allowance. */
  excessBreakMinutes: number;
  /** Net working time still to reach the expected net day (0 once reached). */
  remainingMinutes: number;
  onBreak: boolean;
};

export function workSummary(sessions: readonly AttendanceSession[], policy: WorkPolicy = DEFAULT_WORK_POLICY, now: Date = new Date()): WorkSummary {
  const elapsed = sessions.reduce((sum, s) => sum + sessionMinutes(s, now), 0);
  const breaks = Math.min(elapsed, sessions.reduce((sum, s) => sum + breakMinutes(s, now), 0));
  const net = elapsed - breaks;
  return {
    elapsedMinutes: elapsed,
    breakMinutes: breaks,
    netMinutes: net,
    excessBreakMinutes: Math.max(0, breaks - policy.breakAllowanceMinutes),
    remainingMinutes: Math.max(0, expectedNetMinutes(policy) - net),
    onBreak: sessions.some((s) => !s.checkOutAt && (s.breaks ?? []).some((b) => !b.endedAt)),
  };
}

/**
 * Day classifications available before shifts and policies exist
 * (milestone 1). Late, early departure, absent, holiday and weekly off need a
 * shift or policy and are added with them.
 */
export type DayStatus = "CHECKED_IN" | "PRESENT" | "MISSING_CHECKOUT" | "NO_RECORD" | "CL" | "LWP" | "WFH" | "HOLIDAY" | "WEEKLY_OFF";

/** Approved leave, holidays and weekly offs that shape a day without attendance (034). */
export type DayContext = {
  /** Approved leave by date. */
  leave?: ReadonlyMap<string, "CL" | "LWP" | "WFH">;
  /** Active holidays by date (name). */
  holidays?: ReadonlyMap<string, string>;
  /** 0 = Sunday ... 6 = Saturday. */
  weeklyOffDays?: readonly number[];
};

export const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  CHECKED_IN: "Checked in",
  PRESENT: "Present",
  MISSING_CHECKOUT: "Missing check-out",
  NO_RECORD: "No record",
  CL: "Casual Leave",
  LWP: "Leave Without Pay",
  WFH: "Work From Home",
  HOLIDAY: "Holiday",
  WEEKLY_OFF: "Weekly off",
};

export const DAY_STATUS_STYLES: Record<DayStatus, string> = {
  CHECKED_IN: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/30",
  PRESENT: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  MISSING_CHECKOUT: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  NO_RECORD: "bg-muted text-muted-foreground ring-border",
  CL: "bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/30",
  LWP: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/30",
  WFH: "bg-teal-50 text-teal-700 ring-teal-600/20 dark:bg-teal-500/10 dark:text-teal-300 dark:ring-teal-400/30",
  HOLIDAY: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-600/20 dark:bg-fuchsia-500/10 dark:text-fuchsia-300 dark:ring-fuchsia-400/30",
  WEEKLY_OFF: "bg-muted text-muted-foreground ring-border",
};

export const DAY_STATUS_DOT: Record<DayStatus, string> = {
  CHECKED_IN: "bg-sky-500",
  PRESENT: "bg-emerald-500",
  MISSING_CHECKOUT: "bg-amber-500",
  NO_RECORD: "bg-muted-foreground/40",
  CL: "bg-indigo-500",
  LWP: "bg-rose-500",
  WFH: "bg-teal-500",
  HOLIDAY: "bg-fuchsia-500",
  WEEKLY_OFF: "bg-muted-foreground/40",
};

/** Whole minutes in a session; an open session counts up to `now`. */
export function sessionMinutes(session: Pick<AttendanceSession, "checkInAt" | "checkOutAt">, now: Date = new Date()) {
  const start = Date.parse(session.checkInAt);
  const end = session.checkOutAt ? Date.parse(session.checkOutAt) : now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.floor((end - start) / 60000);
}

export function totalMinutes(sessions: readonly AttendanceSession[], now: Date = new Date()) {
  return sessions.reduce((sum, s) => sum + sessionMinutes(s, now), 0);
}

/** 425 -> "7h 05m"; 0 -> "0h 00m". */
export function formatDuration(minutes: number) {
  const m = Math.max(0, Math.floor(minutes));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Elapsed seconds as "07:05:09" for the live timer. */
export function formatClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** A timestamp's time of day in the attendance timezone, e.g. "9:05 AM". */
export function formatTime(value: string | null | undefined, timeZone: string = BUSINESS_TIMEZONE) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: safeZone(timeZone) });
}

function safeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return BUSINESS_TIMEZONE;
  }
}

export type DaySummary = {
  date: string;
  status: DayStatus;
  sessions: AttendanceSession[];
  firstCheckIn: string | null;
  lastCheckOut: string | null;
  /** Elapsed minutes (check-in to check-out), as before 033. */
  minutes: number;
  /** Breaks, net work, excess break and remaining time (033). */
  work: WorkSummary;
  /** Holiday name when the date is an active public holiday (034). */
  holiday: string | null;
  /** Approved leave on the date (034). */
  leave: "CL" | "LWP" | "WFH" | null;
};

/**
 * Summary of one local date. An open session is "checked in" on the day it
 * started and "missing check-out" once that day is over.
 */
export function summarizeDay(
  date: string,
  sessions: readonly AttendanceSession[],
  today: string,
  now: Date = new Date(),
  policy: WorkPolicy = DEFAULT_WORK_POLICY,
  context: DayContext = {},
): DaySummary {
  const mine = sessions.filter((s) => s.workDate === date).sort((a, b) => a.checkInAt.localeCompare(b.checkInAt));
  const open = mine.find((s) => !s.checkOutAt);
  const closed = mine.filter((s) => s.checkOutAt);
  let status: DayStatus = "NO_RECORD";
  const holiday = context.holidays?.get(date) ?? null;
  const leave = context.leave?.get(date) ?? null;
  if (open) status = date < today ? "MISSING_CHECKOUT" : "CHECKED_IN";
  else if (closed.length > 0) status = "PRESENT";
  // A day without attendance: a holiday or weekly off inside a leave range is
  // not a leave day (it is not counted against the balance either), so they
  // come first; then approved leave.
  else if (holiday) status = "HOLIDAY";
  else if (context.weeklyOffDays?.includes(weekdayOf(date))) status = "WEEKLY_OFF";
  else if (leave) status = leave;
  // A missing check-out is not counted as worked time: it would run until
  // someone notices. Closed sessions still count.
  const counted = status === "MISSING_CHECKOUT" ? closed : mine;
  const lastOut = closed.map((s) => s.checkOutAt!).sort().at(-1) ?? null;
  return {
    date,
    status,
    sessions: mine,
    firstCheckIn: mine[0]?.checkInAt ?? null,
    lastCheckOut: open ? null : lastOut,
    minutes: totalMinutes(counted, now),
    work: workSummary(counted, policy, now),
    holiday,
    leave,
  };
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string) {
  const day = weekdayOf(iso);
  return addDaysISO(iso, day === 0 ? -6 : 1 - day);
}

/** The seven dates (Monday–Sunday) of the week containing `iso`. */
export function weekDates(iso: string) {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A valid "YYYY-MM", else the month of `today`. */
export function parseMonth(value: unknown, today: string) {
  return typeof value === "string" && MONTH_RE.test(value) ? value : today.slice(0, 7);
}

export function addMonths(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function monthRange(month: string) {
  const first = `${month}-01`;
  const last = addDaysISO(`${addMonths(month, 1)}-01`, -1);
  return { first, last };
}

/** Calendar weeks (Monday first) covering a month; days outside it are null. */
export function monthGrid(month: string): (string | null)[][] {
  const { first, last } = monthRange(month);
  const weeks: (string | null)[][] = [];
  let day = weekStart(first);
  while (day <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const d = addDaysISO(day, i);
      return d >= first && d <= last ? d : null;
    }));
    day = addDaysISO(day, 7);
  }
  return weeks;
}

export function formatMonth(month: string) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Mon, Oct 27" for a YYYY-MM-DD date. */
export function formatDay(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
