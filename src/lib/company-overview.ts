// Pure helpers for the super admin's company overview (no I/O, unit-tested).

export type WorkspaceOverview = {
  workspaceId: string;
  name: string;
  today: string;
  /** Active Admins and Individuals (super admins do not report). */
  employees: number;
  openTasks: number;
  overdueTasks: number;
  blockedTasks: number;
  completedToday: number;
  morningPlans: number;
  eveningReports: number;
};

/** The UTC instant at which `date` (YYYY-MM-DD) begins in `timeZone`. */
export function startOfDayUtc(date: string, timeZone: string): string {
  const guess = new Date(`${date}T00:00:00Z`);
  const local = new Date(guess.toLocaleString("en-US", { timeZone }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess.getTime() - (local.getTime() - utc.getTime())).toISOString();
}

type Totals = Omit<WorkspaceOverview, "workspaceId" | "name" | "today">;

/** Company totals across workspaces. */
export function companyTotals(rows: readonly WorkspaceOverview[]): Totals {
  const zero: Totals = { employees: 0, openTasks: 0, overdueTasks: 0, blockedTasks: 0, completedToday: 0, morningPlans: 0, eveningReports: 0 };
  return rows.reduce<Totals>((t, r) => {
    for (const k of Object.keys(zero) as (keyof Totals)[]) t[k] += r[k];
    return t;
  }, zero);
}
