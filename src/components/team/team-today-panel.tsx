import { AlertTriangle, Ban, CheckCircle2, History, ListTodo, Moon, Sun, Sunrise } from "lucide-react";

import { StatCard } from "@/components/dashboard/widgets";
import type { TaskRow } from "@/components/tasks/task-list";
import type { EmployeeDay } from "@/lib/team-today";

import { TeamTodayTable } from "./team-today-table";

type Totals = {
  planned: number;
  completed: number;
  pending: number;
  carriedForward: number;
  overdue: number;
  blocked: number;
  morningSubmitted: number;
  eveningSubmitted: number;
  progress: number;
};

/** Employee-wise daily progress (shared by the dashboard and Team Today). */
export function TeamTodayPanel({
  rows,
  tasksByUser,
  totals,
  today,
}: {
  rows: (EmployeeDay & { roleLabel: string; team: string | null })[];
  tasksByUser: Record<string, TaskRow[]>;
  totals: Totals;
  today: string;
}) {
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Planned today" value={totals.planned} icon={Sun} tone="info" />
        <StatCard label="Completed" value={totals.completed} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending" value={totals.pending} icon={ListTodo} />
        <StatCard label="Carried forward" value={totals.carriedForward} icon={History} />
        <StatCard label="Overdue" value={totals.overdue} icon={AlertTriangle} tone={totals.overdue ? "danger" : "default"} />
        <StatCard label="Blocked" value={totals.blocked} icon={Ban} tone={totals.blocked ? "danger" : "default"} />
        <StatCard label={`Morning plans (${rows.length})`} value={totals.morningSubmitted} icon={Sunrise} />
        <StatCard label={`Evening reports (${rows.length})`} value={totals.eveningSubmitted} icon={Moon} />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Team progress today: {totals.progress}% · counts are per assignee, so shared tasks count for each person.
      </p>
      <TeamTodayTable rows={rows} tasksByUser={tasksByUser} today={today} />
    </>
  );
}
