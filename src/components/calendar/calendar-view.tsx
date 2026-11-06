"use client";

import { CalendarClock, Flag, Plus, Video } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PriorityBadge } from "@/components/app/badges";
import type { MemberOption } from "@/components/tasks/assignee-picker";
import { TaskFormDialog, type ProjectOption } from "@/components/tasks/task-form-dialog";
import { TASK_STATUS_DOT, TASK_STATUS_LABELS, formatDate, type Priority, type TaskStatus } from "@/lib/domain";
import type { MeetingOnDay } from "@/lib/meetings";
import { cn } from "@/lib/utils";

export type CalendarItem = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  kind: "scheduled" | "due";
  date: string;
  overdue: boolean;
  where: string;
  assignees: string;
  /** 0–100. */
  progress: number;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Item({ item, compact }: { item: CalendarItem; compact: boolean }) {
  const Icon = item.kind === "due" ? Flag : CalendarClock;
  return (
    <Link
      href={`/tasks/${item.id}`}
      title={`${item.title} — ${item.kind === "due" ? "due" : "scheduled"} · ${TASK_STATUS_LABELS[item.status]} · ${item.progress}%${item.where ? ` · ${item.where}` : ""}`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-muted",
        item.overdue && "text-red-700",
        item.status === "COMPLETED" && "text-muted-foreground line-through",
        !compact && "border bg-card px-2 py-1.5 text-xs",
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", TASK_STATUS_DOT[item.status])} />
      <Icon className="size-3 shrink-0 opacity-60" aria-label={item.kind === "due" ? "Due" : "Scheduled"} />
      <span className="truncate">{item.title}</span>
      {!compact ? (
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden text-muted-foreground sm:inline">{item.where}</span>
          <span className="hidden text-muted-foreground md:inline">{item.assignees}</span>
          <span className="text-muted-foreground tabular-nums">
            {TASK_STATUS_LABELS[item.status]} · {item.progress}%
          </span>
          <PriorityBadge priority={item.priority} />
        </span>
      ) : null}
    </Link>
  );
}

export function CalendarView({
  view,
  days,
  month,
  today,
  items,
  meetings = [],
  canCreate,
  projects,
  clients,
  members,
  workspaceId,
  selfOnly,
}: {
  view: "month" | "week" | "day";
  days: string[];
  month: string;
  today: string;
  items: CalendarItem[];
  /** Meetings the viewer may see, one entry per day (029). */
  meetings?: MeetingOnDay[];
  canCreate: boolean;
  projects: ProjectOption[];
  clients?: { id: string; name: string }[];
  members: MemberOption[];
  workspaceId: string;
  selfOnly: { userId: string } | null;
}) {
  const [createFor, setCreateFor] = useState<string | null>(null);
  const byDay = new Map<string, CalendarItem[]>();
  for (const it of items) byDay.set(it.date, [...(byDay.get(it.date) ?? []), it]);
  const meetingsByDay = new Map<string, MeetingOnDay[]>();
  for (const m of meetings) meetingsByDay.set(m.date, [...(meetingsByDay.get(m.date) ?? []), m]);

  const dayCell = (day: string) => {
    const list = byDay.get(day) ?? [];
    const dayMeetings = meetingsByDay.get(day) ?? [];
    const inMonth = view !== "month" || day.startsWith(month);
    const limit = view === "month" ? 4 : 50;
    return (
      <div
        key={day}
        role={canCreate ? "button" : undefined}
        tabIndex={canCreate ? 0 : undefined}
        aria-label={canCreate ? `Create task on ${formatDate(day)}` : undefined}
        onClick={() => canCreate && setCreateFor(day)}
        onKeyDown={(e) => {
          if (canCreate && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            setCreateFor(day);
          }
        }}
        className={cn(
          "group relative border-r border-b p-1.5",
          view === "month" ? "min-h-28" : "min-h-64",
          !inMonth && "bg-muted/20 text-muted-foreground",
          canCreate && "cursor-pointer hover:bg-muted/30",
        )}
      >
        <div className="mb-1 flex items-center justify-between">
          <span
            className={cn(
              "text-xs",
              day === today && "inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground",
            )}
          >
            {view === "month" ? Number(day.slice(8)) : `${WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]} ${Number(day.slice(8))}`}
          </span>
          {canCreate ? <Plus className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden="true" /> : null}
        </div>
        <ul className="grid gap-1">
          {dayMeetings.map((m) => (
            <li key={`meeting-${m.id}`}>
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={`${m.title}${m.time ? ` · ${m.time}` : ""} · join meeting`}
                className="flex min-w-0 items-center gap-1 rounded bg-sky-50 px-1 py-0.5 text-[11px] text-sky-900 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-200"
              >
                <Video className="size-3 shrink-0 opacity-70" aria-label="Meeting" />
                {m.time ? <span className="shrink-0 tabular-nums">{m.time.slice(0, 5)}</span> : null}
                <span className="truncate">{m.title}</span>
              </a>
            </li>
          ))}
          {list.slice(0, limit).map((it) => (
            <li key={`${it.id}-${it.kind}`}>
              <Item item={it} compact={view !== "day"} />
            </li>
          ))}
          {list.length > limit ? <li className="px-1 text-[11px] text-muted-foreground">+{list.length - limit} more</li> : null}
        </ul>
      </div>
    );
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-card">
        {view === "day" ? (
          <div className="border-l">{dayCell(days[0]!)}</div>
        ) : (
          <div className={cn("grid border-l", view === "month" ? "min-w-[52rem] grid-cols-7" : "min-w-[60rem] grid-cols-7")}>
            {view === "month"
              ? WEEKDAYS.map((d) => (
                  <div key={d} className="border-r border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {d}
                  </div>
                ))
              : null}
            {days.map(dayCell)}
          </div>
        )}
      </div>
      <p className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CalendarClock className="size-3" aria-hidden="true" /> Scheduled
        </span>
        <span className="flex items-center gap-1">
          <Flag className="size-3" aria-hidden="true" /> Due
        </span>
        {meetings.length ? (
          <span className="flex items-center gap-1">
            <Video className="size-3" aria-hidden="true" /> Meeting
          </span>
        ) : null}
        {canCreate ? <span>Click an empty day to create a task scheduled for it.</span> : null}
      </p>
      {createFor ? (
        <TaskFormDialog
          mode="create"
          open
          onOpenChange={(o) => !o && setCreateFor(null)}
          projects={projects}
          clients={clients}
          members={members}
          workspaceId={workspaceId}
          selfOnly={selfOnly}
          defaultScheduledDate={createFor}
        />
      ) : null}
    </>
  );
}
