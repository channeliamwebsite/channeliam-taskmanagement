// Leave and holiday helpers shared by server and client code (034). Pure
// functions only; the database re-checks every rule (hr_apply_leave,
// hr_decide_leave), so these exist for clear, early messages and display.

export type LeaveType = "CL" | "LWP" | "WFH";
export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export const LEAVE_TYPES: LeaveType[] = ["CL", "LWP", "WFH"];

export const LEAVE_LABELS: Record<LeaveType, string> = {
  CL: "Casual Leave",
  LWP: "Leave Without Pay",
  WFH: "Work From Home",
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const LEAVE_STATUS_STYLES: Record<LeaveStatus, string> = {
  PENDING: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  REJECTED: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30",
  CANCELLED: "bg-muted text-muted-foreground ring-border",
};

export function isLeaveType(value: unknown): value is LeaveType {
  return value === "CL" || value === "LWP" || value === "WFH";
}

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type LeaveInput = { type: LeaveType; start: string; end: string; reason: string };

/** Same rules as hr_apply_leave, checked before the request is sent. */
export function validateLeaveInput(raw: { type?: unknown; start?: unknown; end?: unknown; reason?: unknown }): { ok: true; value: LeaveInput } | { ok: false; error: string } {
  if (!isLeaveType(raw.type)) return { ok: false, error: "Choose a leave type." };
  if (!isIsoDate(raw.start) || !isIsoDate(raw.end)) return { ok: false, error: "Choose a start date and an end date." };
  if (raw.end < raw.start) return { ok: false, error: "The end date is before the start date." };
  if (raw.start.slice(0, 4) !== raw.end.slice(0, 4)) return { ok: false, error: "A leave application must stay within one calendar year. Apply separately for each year." };
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (reason.length < 3 || reason.length > 1000) return { ok: false, error: "Give a reason (3 to 1000 characters)." };
  return { ok: true, value: { type: raw.type, start: raw.start, end: raw.end, reason } };
}

export type LeaveApplication = {
  id: string;
  userId: string;
  type: LeaveType;
  start: string;
  end: string;
  workingDays: number;
  reason: string;
  status: LeaveStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

export type Holiday = { id: string; name: string; date: string; description: string | null; isActive: boolean };

/** Every date (inclusive) of an approved application, mapped to its type. Later applications never overlap (database constraint). */
export function approvedLeaveByDate(applications: readonly LeaveApplication[]): Map<string, LeaveType> {
  const map = new Map<string, LeaveType>();
  for (const a of applications) {
    if (a.status !== "APPROVED") continue;
    for (let d = a.start; d <= a.end; d = nextDay(d)) map.set(d, a.type);
  }
  return map;
}

/** Active holidays by date. */
export function holidaysByDate(holidays: readonly Holiday[]): Map<string, string> {
  return new Map(holidays.filter((h) => h.isActive).map((h) => [h.date, h.name]));
}

function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** "3 Feb – 5 Feb 2027" (or a single date). */
export function formatDateRange(start: string, end: string) {
  const f = (iso: string, withYear: boolean) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  return start === end ? f(start, true) : `${f(start, false)} – ${f(end, true)}`;
}
