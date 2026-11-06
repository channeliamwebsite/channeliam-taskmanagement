import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { ProgressBar, StatusBadge } from "@/components/app/badges";
import { UserAvatar } from "@/components/app/user-avatar";
import type { ProjectSummary } from "@/lib/data/projects";
import type { TaskSummary } from "@/lib/data/tasks";
import { ROLE_LABELS, type UserRole } from "@/lib/auth/roles";
import { formatDate, isOverdue } from "@/lib/domain";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "brand" | "danger" | "success" | "info" | "warning" | "violet";

const STAT_TONES: Record<StatTone, { card: string; icon: string; value: string }> = {
  default: { card: "from-surface to-card", icon: "bg-neutral-soft text-neutral-foreground", value: "text-foreground" },
  brand: { card: "from-brand-soft/70 to-card", icon: "bg-brand-soft text-primary", value: "text-foreground" },
  danger: { card: "from-danger-soft/70 to-card", icon: "bg-danger-soft text-danger-foreground", value: "text-danger-foreground" },
  success: { card: "from-success-soft/70 to-card", icon: "bg-success-soft text-success-foreground", value: "text-foreground" },
  info: { card: "from-info-soft/70 to-card", icon: "bg-info-soft text-info-foreground", value: "text-foreground" },
  warning: { card: "from-warning-soft/70 to-card", icon: "bg-warning-soft text-warning-foreground", value: "text-foreground" },
  violet: { card: "from-violet-soft/70 to-card", icon: "bg-violet-soft text-violet-foreground", value: "text-foreground" },
};

/** Summary figure: tinted card, round icon, large value, label and an optional caption. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  href,
  hint,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: StatTone;
  href?: string;
  /** Small caption under the label, e.g. "83% completion". */
  hint?: string;
}) {
  const t = STAT_TONES[tone];
  const body = (
    <>
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", t.icon)}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-muted-foreground">{label}</span>
        <span className={cn("block text-2xl leading-tight font-semibold tracking-tight tabular-nums", t.value)}>{value}</span>
        {hint ? <span className="block truncate text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </>
  );
  const cls = cn("flex items-center gap-3.5 rounded-xl border border-border/80 bg-gradient-to-br p-4 shadow-card", t.card);
  return href ? (
    <Link href={href} className={cn(cls, "transition-shadow outline-none hover:shadow-pop focus-visible:ring-3 focus-visible:ring-ring/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function CompactTaskList({
  tasks,
  today,
  empty,
  showAssignee = false,
}: {
  tasks: TaskSummary[];
  today: string;
  empty: string;
  showAssignee?: boolean;
}) {
  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="-my-2 divide-y">
      {tasks.map((t) => {
        const overdue = isOverdue(t.dueDate, t.status, today);
        const primary = t.assignees[0];
        return (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <Link href={`/tasks/${t.id}`} className="block truncate text-sm font-medium hover:underline">
                {t.title}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {t.projectName}
                {showAssignee ? ` · ${primary ? primary.fullName || primary.email : "Unassigned"}` : ""}
              </p>
            </div>
            <span className={cn("hidden shrink-0 text-xs sm:inline", overdue ? "font-medium text-red-600" : "text-muted-foreground")}>
              {t.dueDate ? formatDate(t.dueDate) : ""}
            </span>
            <StatusBadge status={t.status} className="shrink-0" />
          </li>
        );
      })}
    </ul>
  );
}

export function ProjectProgressList({ projects, empty }: { projects: ProjectSummary[]; empty: string }) {
  if (projects.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-3">
      {projects.map((p) => (
        <li key={p.id}>
          <Link href={`/projects/${p.id}`} className="group grid gap-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-medium group-hover:underline">{p.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {p.completedTasks}/{p.totalTasks} · {p.progress}%
              </span>
            </div>
            <ProgressBar value={p.progress} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export type Workload = {
  userId: string;
  name: string;
  role: UserRole;
  open: number;
  overdue: number;
  completed: number;
};

export function WorkloadTable({ rows, empty }: { rows: Workload[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-4 pb-2 font-medium">Member</th>
            <th className="px-2 pb-2 text-right font-medium">Open</th>
            <th className="px-2 pb-2 text-right font-medium">Overdue</th>
            <th className="px-4 pb-2 text-right font-medium">Completed</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.userId}>
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <UserAvatar name={r.name} seed={r.userId} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block text-xs text-muted-foreground">{ROLE_LABELS[r.role]}</span>
                  </span>
                </span>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{r.open}</td>
              <td className={cn("px-2 py-2 text-right tabular-nums", r.overdue && "font-medium text-red-600")}>{r.overdue}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
