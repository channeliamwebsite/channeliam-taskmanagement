import Link from "next/link";

import type { ActivityItem } from "@/lib/data/activity";
import {
  ACTIVITY_LABELS,
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  TASK_STATUS_LABELS,
  formatDate,
  formatDateTime,
  type Priority,
  type ProjectStatus,
  type TaskStatus,
} from "@/lib/domain";
import type { Json } from "@/types/database";

import { UserAvatar } from "./user-avatar";

function field(value: Json | null, key: string): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = (value as Record<string, Json | undefined>)[key];
    return v === null || v === undefined ? null : String(v);
  }
  return null;
}

function detail(item: ActivityItem, names: Map<string, string>): string | null {
  switch (item.action) {
    case "STATUS_CHANGED": {
      const from = field(item.oldValue, "status") as TaskStatus | null;
      const to = field(item.newValue, "status") as TaskStatus | null;
      return from && to ? `${TASK_STATUS_LABELS[from] ?? from} → ${TASK_STATUS_LABELS[to] ?? to}` : null;
    }
    case "PRIORITY_CHANGED": {
      const from = field(item.oldValue, "priority") as Priority | null;
      const to = field(item.newValue, "priority") as Priority | null;
      return from && to ? `${PRIORITY_LABELS[from] ?? from} → ${PRIORITY_LABELS[to] ?? to}` : null;
    }
    case "PROGRESS_CHANGED":
      return `${field(item.oldValue, "progress") ?? 0}% → ${field(item.newValue, "progress") ?? 0}%`;
    case "TASK_SCHEDULED":
      return `${formatDate(field(item.oldValue, "scheduled_date"))} → ${formatDate(field(item.newValue, "scheduled_date"))}`;
    case "DUE_DATE_CHANGED":
      return `${formatDate(field(item.oldValue, "due_date"))} → ${formatDate(field(item.newValue, "due_date"))}`;
    case "TASK_ASSIGNED": {
      const id = field(item.newValue, "user_id");
      return id ? (names.get(id) ?? "a teammate") : null;
    }
    case "TASK_UNASSIGNED": {
      const id = field(item.oldValue, "user_id");
      return id ? (names.get(id) ?? "a teammate") : null;
    }
    case "PROJECT_STATUS_CHANGED": {
      const from = field(item.oldValue, "status") as ProjectStatus | null;
      const to = field(item.newValue, "status") as ProjectStatus | null;
      return from && to ? `${PROJECT_STATUS_LABELS[from] ?? from} → ${PROJECT_STATUS_LABELS[to] ?? to}` : null;
    }
    default:
      return null;
  }
}

export function ActivityFeed({
  items,
  names,
  showTarget = true,
  emptyText = "No activity yet.",
}: {
  items: ActivityItem[];
  names: Map<string, string>;
  showTarget?: boolean;
  emptyText?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ol className="grid gap-3">
      {items.map((item) => {
        const actor = item.actorName ?? "System";
        const extra = detail(item, names);
        return (
          <li key={item.id} className="flex gap-2.5 text-sm">
            <UserAvatar name={actor} size="sm" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="leading-snug">
                <span className="font-medium">{actor}</span>{" "}
                <span className="text-muted-foreground">{ACTIVITY_LABELS[item.action] ?? item.action}</span>
                {extra ? <span className="text-foreground"> {extra}</span> : null}
                {showTarget && item.taskId && item.taskTitle ? (
                  <>
                    {" "}
                    <span className="text-muted-foreground">on</span>{" "}
                    <Link href={`/tasks/${item.taskId}`} className="font-medium hover:underline">
                      {item.taskTitle}
                    </Link>
                  </>
                ) : showTarget && !item.taskId && item.projectId && item.projectName ? (
                  <>
                    {" "}
                    <Link href={`/projects/${item.projectId}`} className="font-medium hover:underline">
                      {item.projectName}
                    </Link>
                  </>
                ) : null}
              </p>
              <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                {formatDateTime(item.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
