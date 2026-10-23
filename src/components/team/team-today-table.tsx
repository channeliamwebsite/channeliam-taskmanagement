"use client";

import { CheckCircle2, ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { ProgressBar } from "@/components/app/badges";
import { UserAvatar } from "@/components/app/user-avatar";
import { TaskList, type TaskRow } from "@/components/tasks/task-list";
import { NativeSelect } from "@/components/ui/native-select";
import type { EmployeeDay } from "@/lib/team-today";
import { cn } from "@/lib/utils";

function Submitted({ done }: { done: boolean }) {
  return done ? (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
      <CheckCircle2 className="size-3.5" aria-hidden="true" /> Submitted
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Clock className="size-3.5" aria-hidden="true" /> Not yet
    </span>
  );
}

export function TeamTodayTable({
  rows,
  tasksByUser,
  today,
}: {
  rows: (EmployeeDay & { roleLabel: string; team: string | null })[];
  tasksByUser: Record<string, TaskRow[]>;
  today: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [employee, setEmployee] = useState("");
  const [department, setDepartment] = useState("");
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No employees to show.</p>;

  const departments = [...new Set(rows.map((r) => r.team).filter((t): t is string => Boolean(t)))].sort();
  const visible = rows.filter(
    (r) => (!employee || r.userId === employee) && (!department || (department === "__none__" ? !r.team : r.team === department)),
  );

  const num = (n: number, danger = false) => (
    <td className={cn("px-2 py-2.5 text-right tabular-nums", danger && n > 0 && "font-medium text-red-600")}>{n}</td>
  );

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        <NativeSelect
          aria-label="Select employee"
          value={employee}
          onChange={(e) => {
            setEmployee(e.target.value);
            // Selecting a person shows their work for today straight away.
            if (e.target.value) setOpen(new Set([e.target.value]));
          }}
          className="sm:w-60"
        >
          <option value="">All employees</option>
          {rows.map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Filter by department" value={department} onChange={(e) => setDepartment(e.target.value)} className="sm:w-56">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="__none__">No department</option>
        </NativeSelect>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-2 py-2 text-right font-medium">Planned</th>
              <th className="px-2 py-2 text-right font-medium">Done today</th>
              <th className="px-2 py-2 text-right font-medium">Pending</th>
              <th className="px-2 py-2 text-right font-medium">In progress</th>
              <th className="px-2 py-2 text-right font-medium">Carried</th>
              <th className="px-2 py-2 text-right font-medium">Overdue</th>
              <th className="px-2 py-2 text-right font-medium">Blocked</th>
              <th className="w-32 px-3 py-2 font-medium">Progress</th>
              <th className="px-3 py-2 font-medium">Morning plan</th>
              <th className="px-3 py-2 font-medium">Evening report</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((r) => {
              const isOpen = open.has(r.userId);
              const tasks = tasksByUser[r.userId] ?? [];
              return (
                <Fragment key={r.userId}>
                  <tr className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggle(r.userId)}
                        className="flex items-center gap-2 text-left"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Hide" : "Show"} ${r.name}'s tasks`}
                        disabled={tasks.length === 0}
                      >
                        <ChevronRight
                          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90", tasks.length === 0 && "opacity-0")}
                          aria-hidden="true"
                        />
                        <UserAvatar name={r.name} seed={r.userId} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[r.roleLabel, r.team].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                    </td>
                    {num(r.planned)}
                    <td className="px-2 py-2.5 text-right tabular-nums text-emerald-700">{r.completedToday}</td>
                    {num(r.pending)}
                    {num(r.inProgress)}
                    <td className={cn("px-2 py-2.5 text-right tabular-nums", r.carriedForward > 0 && "text-amber-700")}>{r.carriedForward}</td>
                    {num(r.overdue, true)}
                    {num(r.blocked, true)}
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <ProgressBar value={r.progress} />
                        <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{r.progress}%</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Submitted done={r.morningSubmitted} />
                    </td>
                    <td className="px-3 py-2.5">
                      <Submitted done={r.eveningSubmitted} />
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={11} className="bg-muted/20 px-4 py-3">
                        {tasks.length ? (
                          <TaskList tasks={tasks} today={today} />
                        ) : (
                          <p className="text-sm text-muted-foreground">No tasks for today.</p>
                        )}
                        <Link
                          href={`/tasks?scope=all&assignee=${r.userId}`}
                          className="mt-2 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          Open all of {r.name}&apos;s tasks →
                        </Link>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No employees match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
