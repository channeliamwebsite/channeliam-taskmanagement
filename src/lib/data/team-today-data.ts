import "server-only";

import type { Session } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { displayName } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { buildTeamToday, teamTotals } from "@/lib/team-today";

import { listTasks, toTaskRows } from "./tasks";
import { getWorkspaceMembers, workspaceToday, type Workspace } from "./workspace";

/**
 * Employee-wise "today" for the dashboard and Team Today page. All data is
 * RLS-scoped: super admins see the whole workspace; admins see tasks they
 * created/assigned/are on, their projects' tasks and their direct reports'.
 */
export async function loadTeamToday(session: Session, workspace: Workspace) {
  const today = workspaceToday(workspace);
  const me = session.user.id;
  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const supabase = await createClient();

  const [tasks, members, reportsRes] = await Promise.all([
    listTasks({ workspaceId: workspace.id }),
    getWorkspaceMembers(workspace.id),
    supabase
      .from("daily_reports")
      .select("user_id, morning_submitted_at, evening_submitted_at")
      .eq("workspace_id", workspace.id)
      .eq("report_date", today),
  ]);
  if (reportsRes.error) throw new Error("Failed to load daily reports");

  const active = members.filter((m) => m.isActive);
  const visibleAssignees = new Set(tasks.flatMap((t) => t.assignees.map((a) => a.userId)));
  // Admins: themselves, their direct reports, and anyone on work they can see.
  const employees = active.filter(
    (m) => isSuperAdmin || m.userId === me || m.managerId === me || visibleAssignees.has(m.userId),
  );

  const reports = new Map(
    reportsRes.data.map((r) => [r.user_id, { morning: Boolean(r.morning_submitted_at), evening: Boolean(r.evening_submitted_at) }]),
  );

  const rows = buildTeamToday(
    employees.map((m) => ({ userId: m.userId, name: displayName({ full_name: m.fullName, email: m.email }) })),
    tasks.map((t) => ({
      id: t.id,
      status: t.status,
      scheduledDate: t.scheduledDate,
      dueDate: t.dueDate,
      completedAt: t.completedAt,
      assigneeIds: t.assignees.map((a) => a.userId),
    })),
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

  return { today, rows, tasksByUser, totals: teamTotals(rows), members };
}
