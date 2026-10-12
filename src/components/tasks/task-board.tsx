"use client";

import { CalendarDays, CornerDownRight } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { PriorityBadge } from "@/components/app/badges";
import { AvatarStack } from "@/components/app/user-avatar";
import { updateTaskStatus } from "@/lib/actions/tasks";
import { BOARD_STATUSES, TASK_STATUS_DOT, TASK_STATUS_LABELS, formatDate, isOverdue, type TaskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

import type { TaskRow } from "./task-list";

/** Kanban board. Drag a card to another column to change its status. */
export function TaskBoard({ tasks, today }: { tasks: TaskRow[]; today: string }) {
  const [, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState<TaskStatus | null>(null);
  const [optimistic, moveTask] = useOptimistic(tasks, (state, move: { id: string; status: TaskStatus }) =>
    state.map((t) => (t.id === move.id ? { ...t, status: move.status } : t)),
  );

  function drop(taskId: string, status: TaskStatus) {
    const task = optimistic.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    if (!task.canUpdateStatus) {
      toast.error("You can't change the status of this task.");
      return;
    }
    startTransition(async () => {
      moveTask({ id: taskId, status });
      const result = await updateTaskStatus(taskId, status);
      if (result.ok) toast.success(`Moved to ${TASK_STATUS_LABELS[status]}`);
      else toast.error(result.error);
    });
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[60rem] grid-cols-5 gap-3">
        {BOARD_STATUSES.map((status) => {
          const column = optimistic.filter((t) => t.status === status);
          return (
            <section
              key={status}
              aria-label={TASK_STATUS_LABELS[status]}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(status);
              }}
              onDragLeave={() => setDragOver((s) => (s === status ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(null);
                drop(e.dataTransfer.getData("text/task-id"), status);
              }}
              className={cn(
                "flex min-h-40 flex-col rounded-xl border bg-muted/30 p-2 transition-colors",
                dragOver === status && "border-primary/40 bg-primary/[0.04]",
              )}
            >
              <header className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
                <span className={cn("size-2 rounded-full", TASK_STATUS_DOT[status])} aria-hidden="true" />
                {TASK_STATUS_LABELS[status]}
                <span className="ml-auto rounded bg-background px-1.5 py-0.5 font-medium tabular-nums">{column.length}</span>
              </header>
              <ul className="flex flex-1 flex-col gap-2">
                {column.map((t) => {
                  const overdue = isOverdue(t.dueDate, t.status, today);
                  return (
                    <li
                      key={t.id}
                      draggable={t.canUpdateStatus}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/task-id", t.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className={cn(
                        "rounded-lg border bg-card p-2.5 shadow-xs",
                        t.canUpdateStatus && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <Link href={`/tasks/${t.id}`} className="line-clamp-2 text-sm font-medium hover:underline">
                        {t.title}
                      </Link>
                      {t.projectName ? (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                          {t.parentTaskId ? <CornerDownRight className="size-3 shrink-0" aria-label="Subtask" /> : null}
                          <span className="truncate">{[t.clientName, t.projectName].filter(Boolean).join(" · ")}</span>
                        </p>
                      ) : null}
                      {t.subtaskTotal ? (
                        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                          {t.subtaskDone ?? 0}/{t.subtaskTotal} subtasks done
                        </p>
                      ) : null}
                      {t.flags?.length ? (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {t.flags.map((f) => (
                            <span
                              key={f.label}
                              className={cn(
                                "rounded px-1.5 py-px text-[10px] font-medium",
                                f.tone === "red" ? "bg-red-50 text-red-700" : f.tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-700",
                              )}
                            >
                              {f.label}
                            </span>
                          ))}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <PriorityBadge priority={t.priority} />
                        <AvatarStack people={t.assignees.map((a) => ({ id: a.userId, name: a.name }))} max={2} />
                      </div>
                      {t.dueDate ? (
                        <p className={cn("mt-2 flex items-center gap-1 text-xs", overdue ? "font-medium text-red-600" : "text-muted-foreground")}>
                          <CalendarDays className="size-3" aria-hidden="true" />
                          {formatDate(t.dueDate)}
                          {overdue ? " · Overdue" : ""}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
                {column.length === 0 ? (
                  <li className="rounded-lg border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">No tasks</li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
