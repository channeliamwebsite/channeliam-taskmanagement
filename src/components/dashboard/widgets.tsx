import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { ProgressBar, StatusBadge } from "@/components/app/badges";
import { UserAvatar } from "@/components/app/user-avatar";
import type { ProjectSummary } from "@/lib/data/projects";
import type { TaskSummary } from "@/lib/data/tasks";
import { ROLE_LABELS, type UserRole } from "@/lib/auth/roles";
import { formatDate, isOverdue } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: "default" | "danger" | "success" | "info";
  href?: string;
}) {
  const tones = {
    default: "bg-muted text-foreground",
    danger: "bg-red-50 text-red-600",
    success: "bg-emerald-50 text-emerald-600",
    info: "bg-blue-50 text-blue-600",
  };
  const body = (
    <>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-semibold tabular-nums">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </>
  );
  const cls = "flex items-center gap-3 rounded-xl border bg-card p-3.5";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:bg-muted/40")}>
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
