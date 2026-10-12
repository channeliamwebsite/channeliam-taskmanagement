"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { updateTaskStatus } from "@/lib/actions/tasks";
import { TASK_STATUSES, TASK_STATUS_DOT, TASK_STATUS_LABELS, type TaskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Inline status changer with optimistic update; the server enforces permissions. */
export function TaskStatusSelect({
  taskId,
  status,
  disabled,
  className,
}: {
  taskId: string;
  status: TaskStatus;
  disabled?: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(status);

  return (
    <label className={cn("relative inline-flex items-center", className)}>
      <span className="sr-only">Status</span>
      <span className={cn("pointer-events-none absolute left-2 size-2 rounded-full", TASK_STATUS_DOT[optimistic])} aria-hidden="true" />
      <select
        value={optimistic}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value as TaskStatus;
          startTransition(async () => {
            setOptimistic(next);
            const result = await updateTaskStatus(taskId, next);
            if (result.ok) toast.success(`Status changed to ${TASK_STATUS_LABELS[next]}`);
            else toast.error(result.error);
          });
        }}
        className="h-7 cursor-pointer appearance-none rounded-md border border-input bg-background pr-2 pl-5 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
