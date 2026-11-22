import "server-only";

import type { Session } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { displayName } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { uniqueById } from "@/lib/task-query";
import { buildTeamToday, mergeDailyReports, teamTotals } from "@/lib/team-today";

import { listTasks, toTaskRows } from "./tasks";
import { departmentWorkspacesOf, getCompanyWideMembers, getMyWorkspaces, getWorkspaceMembers, workspaceToday, type Workspace } from "./workspace";
import { loadError } from "./errors";

/**
 * Employee-wise "today" for the dashboard and Team Today page. All data is
 * RLS-scoped: super admins see every department (non-personal) workspace,
 * company-wide (048/Employees-page precedent); admins see tasks they
 * created/assigned/are on, their projects' tasks and their direct reports',
 * scoped to the active workspace only, unchanged. The dashboard only calls
 * this for Admin, so the super-admin branch below is exercised solely by
 * Team Today.
 *
 * "today" and its timezone stay anchored to the active workspace (unchanged
 * semantics) even for the super-admin company-wide view: department
 * workspaces share the business timezone (Asia/Kolkata) in practice, and
 * buildTeamToday/teamTotals take one today/timeZone per call, so a single
 * anchor is the correct answer for one company-wide "today".
 */
export async function loadTeamToday(session: Session, workspace: Workspace) {
  const today = workspaceToday(workspace);
  const me = session.user.id;
  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const supabase = await createClient();

  // Today's numbers only need open tasks and tasks completed today; the 48-hour
  // window is a superset of "today" in any timezone (buildTeamToday applies the
  // exact local-day check), so the rest of the history is not loaded.
  const completedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const workspaceIds = isSuperAdmin ? departmentWorkspacesOf(await getMyWorkspaces()).map((w) => w.id) : [workspace.id];

  const [openTasks, recentlyCompleted, members, reportRows] = await Promise.all([
    Promise.all(workspaceIds.map((id) => listTasks({ workspaceId: id, openOnly: true }))).then((lists) => lists.flat()),
    Promise.all(workspaceIds.map((id) => listTasks({ workspaceId: id, status: "COMPLETED", completedAfter }))).then((lists) => lists.flat()),
    isSuperAdmin ? getCompanyWideMembers() : getWorkspaceMembers(workspace.id),
    Promise.all(
      workspaceIds.map(async (id) => {
        const { data, error } = await supabase
          .from("daily_reports")
          .select("user_id, morning_submitted_at, evening_submitted_at")
          .eq("workspace_id", id)
          .eq("report_date", today);
        if (error) throw loadError("Failed to load daily reports", error);
        return data ?? [];
      }),
    ).then((lists) => lists.flat()),
  ]);
  // Tasks are workspace-owned, so a task id can repeat here only if the same
  // task satisfied both queries; task ids are globally unique, never shared
  // across workspaces, so merging per-workspace lists adds no new collision.
  const tasks = uniqueById([...openTasks, ...recentlyCompleted]);

  const active = members.filter((m) => m.isActive);
  const visibleAssignees = new Set(tasks.flatMap((t) => t.assignees.map((a) => a.userId)));
  // Admins: themselves, their direct reports, and anyone on work they can see.
  const employees = active.filter(
    (m) => isSuperAdmin || m.userId === me || m.managerId === me || visibleAssignees.has(m.userId),
  );

  const reports = mergeDailyReports(reportRows);

  const teamTasks = tasks.map((t) => ({
    id: t.id,
    status: t.status,
    scheduledDate: t.scheduledDate,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    assigneeIds: t.assignees.map((a) => a.userId),
    hasSubtasks: t.subtaskTotal > 0,
  }));
  const rows = buildTeamToday(
    employees.map((m) => ({ userId: m.userId, name: displayName({ full_name: m.fullName, email: m.email }) })),
    teamTasks,
    reports,
    today,
    workspace.timezone,
  )
    .map((r) => {
      const m = employees.find((e) => e.userId === r.userId)!;
      return { ...r, roleLabel: ROLE_LABELS[m.role], team: m.team };
    })
    .sort((a, b) => (a.team ?? "~").localeCompare(b.team ?? "~") || a.name.localeCompare(b.name));

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const tasksByUser = Object.fromEntries(
    rows.map((r) => [r.userId, toTaskRows(r.taskIds.map((id) => byId.get(id)!).filter(Boolean), session, today)]),
  );

  return { today, rows, tasksByUser, totals: teamTotals(rows, teamTasks, today, workspace.timezone), members };
}
