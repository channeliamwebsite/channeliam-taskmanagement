import { companyTotals, type WorkspaceOverview } from "@/lib/company-overview";
import { cn } from "@/lib/utils";

const COLUMNS = [
  ["employees", "Employees"],
  ["openTasks", "Open tasks"],
  ["overdueTasks", "Overdue"],
  ["blockedTasks", "Blocked"],
  ["completedToday", "Done today"],
  ["morningPlans", "Morning plans"],
  ["eveningReports", "Evening reports"],
] as const;

/** Super admin: one row per workspace plus company totals (figures from the server). */
export function CompanyOverviewTable({ rows, activeId }: { rows: WorkspaceOverview[]; activeId: string }) {
  const totals = companyTotals(rows);
  const warn = (key: (typeof COLUMNS)[number][0], value: number) =>
    (key === "overdueTasks" || key === "blockedTasks") && value > 0 ? "font-medium text-red-600" : undefined;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">Company overview by workspace</caption>
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Workspace
            </th>
            {COLUMNS.map(([key, label]) => (
              <th key={key} scope="col" className="px-3 py-2 text-right font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.workspaceId} className={cn(r.workspaceId === activeId && "bg-muted/40")}>
              <th scope="row" className="py-2 pr-3 text-left font-medium">
                {r.name}
                {r.workspaceId === activeId ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(selected)</span> : null}
              </th>
              {COLUMNS.map(([key]) => (
                <td key={key} className={cn("px-3 py-2 text-right tabular-nums", warn(key, r[key]))}>
                  {key === "morningPlans" || key === "eveningReports" ? `${r[key]} / ${r.employees}` : r[key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t text-xs">
          <tr>
            <th scope="row" className="py-2 pr-3 text-left font-medium">
              Company
            </th>
            {COLUMNS.map(([key]) => (
              <td key={key} className="px-3 py-2 text-right font-medium tabular-nums">
                {key === "morningPlans" || key === "eveningReports" ? `${totals[key]} / ${totals.employees}` : totals[key]}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
