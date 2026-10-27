import Link from "next/link";

import { ProgressBar } from "@/components/app/badges";
import { formatDate, formatDateTime } from "@/lib/domain";
import { percent } from "@/lib/progress";
import type { ProjectProgress } from "@/lib/super-admin-overview";
import { cn } from "@/lib/utils";

/**
 * Super admin: every project, grouped by client, with counts from the
 * project's own tasks (each task once; cancelled and parent tasks excluded).
 */
export function ProjectProgressTable({ rows, today }: { rows: ProjectProgress[]; today: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No projects yet. Add clients and projects to track progress here.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[60rem] text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Client / project</th>
            <th className="px-3 py-2 font-medium">Responsible</th>
            <th className="px-3 py-2 font-medium">Assigned</th>
            <th className="w-36 px-3 py-2 font-medium">Done</th>
            <th className="px-2 py-2 text-right font-medium">In progress</th>
            <th className="px-2 py-2 text-right font-medium">Pending</th>
            <th className="px-2 py-2 text-right font-medium">Blocked</th>
            <th className="px-2 py-2 text-right font-medium">Overdue</th>
            <th className="px-3 py-2 font-medium">Deadline</th>
            <th className="px-3 py-2 font-medium">Last update</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const p = r.project;
            const projectOverdue = p.dueDate !== null && p.dueDate < today && r.completed < r.total;
            return (
              <tr key={p.id} className="align-top hover:bg-muted/30">
                <td className="px-4 py-2.5">
                  {p.clientId ? (
                    <Link href={`/clients/${p.clientId}`} className="block text-xs text-muted-foreground hover:underline">
                      {p.clientName}
                    </Link>
                  ) : (
                    <span className="block text-xs text-muted-foreground">{p.clientName ?? "Internal / no client"}</span>
                  )}
                  <Link href={`/projects/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{p.ownerName ?? "—"}</td>
                <td className="max-w-48 px-3 py-2.5 text-xs text-muted-foreground">{r.assignees.length ? r.assignees.join(", ") : "—"}</td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <ProgressBar value={percent(r.completed, r.total)} />
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {r.completed}/{r.total}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{r.inProgress}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{r.pending}</td>
                <td className={cn("px-2 py-2.5 text-right tabular-nums", r.blocked > 0 && "font-medium text-red-600")}>{r.blocked}</td>
                <td className={cn("px-2 py-2.5 text-right tabular-nums", r.overdue > 0 && "font-medium text-red-600")}>
                  {r.overdue > 0 ? (
                    <Link href={`/tasks?scope=all&project=${p.id}&sort=due`} className="hover:underline">
                      {r.overdue}
                    </Link>
                  ) : (
                    0
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {p.dueDate ? (
                    <span className={cn(projectOverdue ? "font-medium text-red-600" : "text-muted-foreground")}>Project {formatDate(p.dueDate)}</span>
                  ) : null}
                  {r.nextDue ? <span className="block text-muted-foreground">Next task {formatDate(r.nextDue)}</span> : null}
                  {!p.dueDate && !r.nextDue ? <span className="text-muted-foreground">—</span> : null}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.lastUpdate ? formatDateTime(r.lastUpdate) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
