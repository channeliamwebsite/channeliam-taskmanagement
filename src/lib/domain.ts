// Labels, ordering and styles for database enums. Client-safe.

import type { Database } from "@/types/database";

type Enums = Database["public"]["Enums"];
export type TaskStatus = Enums["task_status"];
export type Priority = Enums["priority_level"];
export type TaskType = Enums["task_type"];
export type ProjectStatus = Enums["project_status"];
export type ActivityAction = Enums["activity_action"];

export const TASK_STATUSES: readonly TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
];

/** Kanban columns (cancelled tasks are listed, not boarded). */
export const BOARD_STATUSES: readonly TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "BLOCKED",
  "COMPLETED",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  TODO: "bg-slate-100 text-slate-700 ring-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 ring-blue-200",
  IN_REVIEW: "bg-violet-50 text-violet-700 ring-violet-200",
  BLOCKED: "bg-red-50 text-red-700 ring-red-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CANCELLED: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

export const TASK_STATUS_DOT: Record<TaskStatus, string> = {
  TODO: "bg-slate-400",
  IN_PROGRESS: "bg-blue-500",
  IN_REVIEW: "bg-violet-500",
  BLOCKED: "bg-red-500",
  COMPLETED: "bg-emerald-500",
  CANCELLED: "bg-zinc-400",
};

/** Ordered P1 (most urgent) to P4. Stored values are the existing enum. */
export const PRIORITIES: readonly Priority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];

export const PRIORITY_RANK: Record<Priority, number> = { URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };

export const PRIORITY_LABELS: Record<Priority, string> = {
  URGENT: "P1 Critical",
  HIGH: "P2 High",
  MEDIUM: "P3 Normal",
  LOW: "P4 Low",
};

export const PRIORITY_STYLES: Record<Priority, string> = {
  LOW: "bg-zinc-50 text-zinc-600 ring-zinc-200",
  MEDIUM: "bg-amber-50 text-amber-700 ring-amber-200",
  HIGH: "bg-orange-50 text-orange-700 ring-orange-200",
  URGENT: "bg-red-50 text-red-700 ring-red-200",
};

export const TASK_TYPES: readonly TaskType[] = [
  "TASK",
  "BUG",
  "FEATURE",
  "CONTENT",
  "DESIGN",
  "DEVELOPMENT",
  "SEO",
  "MARKETING",
  "MEETING",
  "OTHER",
];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  TASK: "Task",
  BUG: "Bug",
  FEATURE: "Feature",
  CONTENT: "Content",
  DESIGN: "Design",
  DEVELOPMENT: "Development",
  SEO: "SEO",
  MARKETING: "Marketing",
  MEETING: "Meeting",
  OTHER: "Other",
};

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  ARCHIVED: "Archived",
};

export const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  PLANNING: "bg-slate-100 text-slate-700 ring-slate-200",
  ACTIVE: "bg-blue-50 text-blue-700 ring-blue-200",
  ON_HOLD: "bg-amber-50 text-amber-700 ring-amber-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  ARCHIVED: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};

export const ACTIVITY_LABELS: Record<ActivityAction, string> = {
  TASK_CREATED: "created the task",
  TASK_UPDATED: "updated the task",
  TASK_ASSIGNED: "assigned",
  TASK_UNASSIGNED: "unassigned",
  TASK_REASSIGNED: "reassigned the task",
  STATUS_CHANGED: "changed status",
  PRIORITY_CHANGED: "changed priority",
  PROGRESS_CHANGED: "updated progress",
  DUE_DATE_CHANGED: "changed the due date",
  TASK_SCHEDULED: "rescheduled",
  TASK_COMPLETED: "completed the task",
  COMMENT_ADDED: "commented",
  ATTACHMENT_UPLOADED: "uploaded an attachment",
  PROJECT_CREATED: "created the project",
  PROJECT_UPDATED: "updated the project",
  PROJECT_STATUS_CHANGED: "changed project status",
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}
export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}
export function isTaskType(value: unknown): value is TaskType {
  return typeof value === "string" && (TASK_TYPES as readonly string[]).includes(value);
}
export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

/** Business timezone: all "today", overdue and carry-forward logic uses it. */
export const BUSINESS_TIMEZONE = "Asia/Kolkata";

/** Working days (0 = Sunday … 6 = Saturday). Monday–Saturday by default. */
export const WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6];

/** Date (YYYY-MM-DD) of an instant in a timezone (workspace timezone, default India). */
export function todayISO(date = new Date(), timeZone: string = BUSINESS_TIMEZONE) {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = BUSINESS_TIMEZONE;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Adds calendar days to a YYYY-MM-DD date string. */
export function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOf(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWorkingDay(iso: string) {
  return WORKING_DAYS.includes(weekdayOf(iso));
}

/** The working day a date's unfinished work lands on (the date itself if it is a working day). */
export function nextWorkingDay(iso: string) {
  let day = iso;
  for (let i = 0; i < 7 && !isWorkingDay(day); i++) day = addDaysISO(day, 1);
  return day;
}

export function isOverdue(dueDate: string | null, status: TaskStatus, today = todayISO()) {
  return Boolean(dueDate) && dueDate! < today && status !== "COMPLETED" && status !== "CANCELLED";
}

export function formatDate(date: string | null | undefined) {
  if (!date) return "—";
  // Date-only strings are parsed as local dates to avoid timezone shifts.
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function displayName(profile: { full_name?: string | null; email?: string | null } | null | undefined) {
  return profile?.full_name?.trim() || profile?.email || "Unknown user";
}

export function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Standard teams (profiles.team, meeting_links.team). Free text is still accepted. */
export const TEAM_OPTIONS: readonly string[] = ["Production", "Desk", "Website & SEO"];
