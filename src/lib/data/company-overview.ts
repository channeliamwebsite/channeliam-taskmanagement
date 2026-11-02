import "server-only";

import { startOfDayUtc, type WorkspaceOverview } from "@/lib/company-overview";
import { todayISO } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { loadError } from "./errors";
import type { Workspace } from "./workspace";

export type { WorkspaceOverview };

/**
 * Company-wide figures for super admins, one row per workspace. Computed on
 * the server with counting queries (no task rows are loaded) through the
 * caller's own RLS-scoped client: only a company admin (025) can read every
 * workspace, so for anyone else the figures cover just what they may see.
 * "Today" is each workspace's own date.
 */
export async function getCompanyOverview(workspaces: Workspace[], now = new Date()): Promise<WorkspaceOverview[]> {
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, profile:profiles!workspace_members_user_id_fkey(role, is_active)");
  if (error) throw loadError("Failed to load the company overview", error);
  const employees = new Map<string, number>();
  for (const m of members) {
    if (m.profile && m.profile.is_active && m.profile.role !== "SUPER_ADMIN") {
      employees.set(m.workspace_id, (employees.get(m.workspace_id) ?? 0) + 1);
    }
  }

  const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error: e } = await query;
    if (e) throw loadError("Failed to load the company overview", e);
    return n ?? 0;
  };
  const head = { count: "exact" as const, head: true };

  return Promise.all(
    workspaces.map(async (w) => {
      const today = todayISO(now, w.timezone);
      const open = () =>
        supabase.from("tasks").select("id", head).eq("workspace_id", w.id).not("status", "in", "(COMPLETED,CANCELLED)");
      const [openTasks, overdueTasks, blockedTasks, completedToday, morningPlans, eveningReports] = await Promise.all([
        count(open()),
        count(open().lt("due_date", today)),
        count(supabase.from("tasks").select("id", head).eq("workspace_id", w.id).eq("status", "BLOCKED")),
        count(
          supabase
            .from("tasks")
            .select("id", head)
            .eq("workspace_id", w.id)
            .eq("status", "COMPLETED")
            .gte("completed_at", startOfDayUtc(today, w.timezone)),
        ),
        count(supabase.from("daily_reports").select("id", head).eq("workspace_id", w.id).eq("report_date", today).not("morning_submitted_at", "is", null)),
        count(supabase.from("daily_reports").select("id", head).eq("workspace_id", w.id).eq("report_date", today).not("evening_submitted_at", "is", null)),
      ]);
      return {
        workspaceId: w.id,
        name: w.name,
        today,
        employees: employees.get(w.id) ?? 0,
        openTasks,
        overdueTasks,
        blockedTasks,
        completedToday,
        morningPlans,
        eveningReports,
      };
    }),
  );
}
