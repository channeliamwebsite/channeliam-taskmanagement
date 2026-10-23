"use client";

import { AlertTriangle, CheckCircle2, ChevronRight, CircleDot, ListPlus, ListTodo, Sunrise } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { PriorityBadge, ProgressBar, StatusBadge } from "@/components/app/badges";
import { UserAvatar } from "@/components/app/user-avatar";
import { StatCard } from "@/components/dashboard/widgets";
import { NativeSelect } from "@/components/ui/native-select";
import { trackingLabel, type EmployeeTracking } from "@/lib/daily-tracking";
import { TASK_STATUS_LABELS, formatDateTime, isPriority, isTaskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

export type TrackingEmployee = { userId: string; name: string; team: string | null; roleLabel: string; isActive: boolean };

const LABEL_TONE: Record<string, string> = {
  COMPLETED_EARLY: "bg-emerald-50 text-emerald-700",
  ADDED: "bg-blue-50 text-blue-700",
  ASSIGNED: "bg-blue-50 text-blue-700",
  MOVED_IN: "bg-sky-50 text-sky-800",
  REASSIGNED: "bg-amber-50 text-amber-800",
  CHANGED: "bg-zinc-100 text-zinc-700",
  REMOVED: "bg-zinc-100 text-zinc-700",
};

/**
 * Today's automatic daily report per employee: the morning report generated
 * by the database, compared with live task data (added during the day,
 * completed, in progress, pending, reassigned).
 */
export function DailyTrackingPanel({
  employees,
  summaries,
}: {
  employees: TrackingEmployee[];
  summaries: EmployeeTracking[];
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [department, setDepartment] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const byId = new Map(summaries.map((s) => [s.userId, s]));
  const departments = [...new Set(employees.map((e) => e.team).filter((t): t is string => Boolean(t)))].sort();

  const rows = employees
    .map((e) => ({ e, s: byId.get(e.userId)! }))
    .filter(({ s }) => Boolean(s))
    .filter(({ e }) => !department || (department === "__none__" ? !e.team : e.team === department))
    .filter(({ s }) => !onlyIncomplete || s.pending + s.inProgress > 0);

  const total = (k: "morning" | "added" | "completed" | "inProgress" | "pending") => summaries.reduce((n, s) => n + s[k], 0);
  const incomplete = summaries.filter((s) => s.pending + s.inProgress > 0).length;
  // Deactivated people get no morning report but can still hold open tasks.
  const inactiveWithWork = employees.filter((e) => {
    const s = byId.get(e.userId);
    return !e.isActive && s && s.pending + s.inProgress > 0;
  });
  const generated = summaries.some((s) => s.morningGeneratedAt);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="In morning reports" value={total("morning")} icon={Sunrise} />
        <StatCard label="Added during the day" value={total("added")} icon={ListPlus} tone="info" />
        <StatCard label="Completed" value={total("completed")} icon={CheckCircle2} tone="success" />
        <StatCard label="In progress" value={total("inProgress")} icon={CircleDot} tone="info" />
        <StatCard label="Pending" value={total("pending")} icon={ListTodo} />
        <StatCard label="People with open work" value={incomplete} icon={AlertTriangle} tone={incomplete ? "danger" : "default"} />
      </div>
      <p className="text-xs text-muted-foreground">
        {generated
          ? "Morning reports are generated automatically from each person's tasks at 09:00; the counts below follow live task status. Counts are per person, so a shared task counts for each assignee."
          : "Morning reports are generated automatically at 09:00 (Mon–Sat). Until then this shows each person's current tasks."}
      </p>
      {inactiveWithWork.length ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {inactiveWithWork.length === 1 ? "1 inactive person still has" : `${inactiveWithWork.length} inactive people still have`} open
          tasks ({inactiveWithWork.map((e) => e.name).join(", ")}). Inactive people get no morning report — reassign their work.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Filter by department" value={department} onChange={(e) => setDepartment(e.target.value)} className="w-56">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="__none__">No department</option>
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
          Only people with open work
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-2 py-2 text-right font-medium">Morning</th>
              <th className="px-2 py-2 text-right font-medium">Added</th>
              <th className="px-2 py-2 text-right font-medium">Done</th>
              <th className="px-2 py-2 text-right font-medium">In progress</th>
              <th className="px-2 py-2 text-right font-medium">Pending</th>
              <th className="w-32 px-3 py-2 font-medium">Progress</th>
              <th className="px-3 py-2 font-medium">Morning report</th>
              <th className="px-3 py-2 font-medium">Evening notes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ e, s }) => {
              const isOpen = open.has(e.userId);
              return (
                <Fragment key={e.userId}>
                  <tr className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggle(e.userId)}
                        className="flex items-center gap-2 text-left"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} ${e.name}'s report`}
                      >
                        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} aria-hidden="true" />
                        <UserAvatar name={e.name} seed={e.userId} size="sm" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-medium">{e.name}</span>
                            {e.isActive ? null : (
                              <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-px text-[11px] font-medium text-zinc-700">Inactive</span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{[e.roleLabel, e.team].filter(Boolean).join(" · ")}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{s.morning}</td>
                    <td className={cn("px-2 py-2.5 text-right tabular-nums", s.added > 0 && "text-blue-700")}>{s.added}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-emerald-700">{s.completed}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{s.inProgress}</td>
                    <td className={cn("px-2 py-2.5 text-right tabular-nums", s.pending > 0 && "font-medium text-amber-700")}>{s.pending}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <ProgressBar value={s.progress} />
                        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{s.progress}%</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {s.morningGeneratedAt
                        ? `Generated ${formatDateTime(s.morningGeneratedAt)}`
                        : e.isActive
                          ? "Not generated yet"
                          : "None (inactive)"}
                    </td>
                    <td className={cn("px-3 py-2.5 text-xs", s.eveningSubmittedAt ? "text-emerald-700" : "text-muted-foreground")}>
                      {s.eveningSubmittedAt ? "Submitted" : "Not yet"}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={9} className="bg-muted/20 px-4 py-3">
                        {s.rows.length ? (
                          <ul className="divide-y rounded-lg border bg-card">
                            {s.rows.map((r) => {
                              const label = trackingLabel(r.tracking);
                              const statusChanged = r.morningStatus && r.status && r.morningStatus !== r.status;
                              return (
                                <li key={r.taskId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                                  <Link href={`/tasks/${r.taskId}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                                    {r.title}
                                  </Link>
                                  <span className="hidden text-xs text-muted-foreground md:inline">
                                    {[r.clientName, r.projectName].filter(Boolean).join(" · ")}
                                  </span>
                                  {label ? <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", LABEL_TONE[r.tracking])}>{label}</span> : null}
                                  {statusChanged && isTaskStatus(r.morningStatus) ? (
                                    <span className="text-[11px] text-muted-foreground">was {TASK_STATUS_LABELS[r.morningStatus]}</span>
                                  ) : null}
                                  {isPriority(r.priority) ? <PriorityBadge priority={r.priority} /> : null}
                                  {isTaskStatus(r.status) ? <StatusBadge status={r.status} /> : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted-foreground">No tasks for today.</p>
                        )}
                        <Link href={`/tasks?scope=all&assignee=${e.userId}`} className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">
                          Open all of {e.name}&apos;s tasks →
                        </Link>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {onlyIncomplete ? "Everyone's work for today is complete." : "No employees match these filters."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
