// Attendance calculations shared by server and client code. Pure functions:
// stored check-in/check-out times are the input; day classifications are
// derived here and never stored. Client-safe.

import { BUSINESS_TIMEZONE, addDaysISO, weekdayOf } from "./domain.ts";

export type AttendanceSession = {
  id: string;
  workspaceId: string;
  /** Local date of the check-in (workspace timezone). */
  workDate: string;
  checkInAt: string;
  checkOutAt: string | null;
};

/**
 * Day classifications available before shifts and policies exist
 * (milestone 1). Late, early departure, absent, holiday and weekly off need a
 * shift or policy and are added with them.
 */
export type DayStatus = "CHECKED_IN" | "PRESENT" | "MISSING_CHECKOUT" | "NO_RECORD";

export const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  CHECKED_IN: "Checked in",
  PRESENT: "Present",
  MISSING_CHECKOUT: "Missing check-out",
  NO_RECORD: "No record",
};

export const DAY_STATUS_STYLES: Record<DayStatus, string> = {
  CHECKED_IN: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/30",
  PRESENT: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  MISSING_CHECKOUT: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  NO_RECORD: "bg-muted text-muted-foreground ring-border",
};

export const DAY_STATUS_DOT: Record<DayStatus, string> = {
  CHECKED_IN: "bg-sky-500",
  PRESENT: "bg-emerald-500",
  MISSING_CHECKOUT: "bg-amber-500",
  NO_RECORD: "bg-muted-foreground/40",
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
  minutes: number;
};

/**
 * Summary of one local date. An open session is "checked in" on the day it
 * started and "missing check-out" once that day is over.
 */
export function summarizeDay(date: string, sessions: readonly AttendanceSession[], today: string, now: Date = new Date()): DaySummary {
  const mine = sessions.filter((s) => s.workDate === date).sort((a, b) => a.checkInAt.localeCompare(b.checkInAt));
  const open = mine.find((s) => !s.checkOutAt);
  const closed = mine.filter((s) => s.checkOutAt);
  let status: DayStatus = "NO_RECORD";
  if (open) status = date < today ? "MISSING_CHECKOUT" : "CHECKED_IN";
  else if (closed.length > 0) status = "PRESENT";
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
