"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { setTaskSchedule } from "@/lib/actions/tasks";
import { formatDate } from "@/lib/domain";
import { cn } from "@/lib/utils";

/** Inline "scheduled for" date picker; the server/RLS decide who may change it. */
export function ScheduleInput({
  taskId,
  value,
  disabled,
  className,
}: {
  taskId: string;
  value: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(value ?? "");

  return (
    <input
      type="date"
      aria-label="Scheduled date"
      title={optimistic ? `Scheduled for ${formatDate(optimistic)}` : "Not scheduled"}
      value={optimistic}
      disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.value || null;
        startTransition(async () => {
          setOptimistic(next ?? "");
          const r = await setTaskSchedule(taskId, next);
          if (r.ok) toast.success(next ? `Scheduled for ${formatDate(next)}` : "Schedule cleared");
          else toast.error(r.error);
        });
      }}
      className={cn(
        "h-7 w-[8.5rem] rounded-md border border-input bg-background px-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
        !optimistic && "text-muted-foreground",
        className,
      )}
    />
  );
}
