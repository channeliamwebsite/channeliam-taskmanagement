import {
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_STYLES,
  TASK_STATUS_DOT,
  TASK_STATUS_LABELS,
  TASK_STATUS_STYLES,
  type Priority,
  type ProjectStatus,
  type TaskStatus,
} from "@/lib/domain";
import { cn } from "@/lib/utils";

const base = "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset";

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span className={cn(base, TASK_STATUS_STYLES[status], className)}>
      <span className={cn("size-1.5 rounded-full", TASK_STATUS_DOT[status])} aria-hidden="true" />
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return <span className={cn(base, PRIORITY_STYLES[priority], className)}>{PRIORITY_LABELS[priority]}</span>;
}

export function ProjectStatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return <span className={cn(base, PROJECT_STATUS_STYLES[status], className)}>{PROJECT_STATUS_LABELS[status]}</span>;
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${pct}% complete`}
    >
      <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}
