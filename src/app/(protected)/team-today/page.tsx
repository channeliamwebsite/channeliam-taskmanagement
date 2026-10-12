import { AlertTriangle, Ban, CheckCircle2, FileCheck, History, ListTodo, Sun } from "lucide-react";
import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/dashboard/widgets";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TeamTodayTable } from "@/components/team/team-today-table";
import { ROLE_LABELS, ROUTE_ROLES } from "@/lib/auth/roles";
import { listProjectOptions } from "@/lib/data/projects";
import { listTasks, toTaskRows } from "@/lib/data/tasks";
import { getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { displayName, formatDate } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { buildTeamToday, teamTotals } from "@/lib/team-today";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Team Today" };

export default async function TeamTodayPage() {
  const { session, workspace } = await getPageContext(ROUTE_ROLES["/team-today"]);
  if (!workspace) return <NoWorkspace session={session} />;

  const today = workspaceToday(workspace);
  const me = session.user.id;
  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const supabase = await createClient();

  // Tasks come from RLS-scoped queries: super admins see the whole workspace;
  // admins see tasks they created/assigned/are on, their projects' tasks and
  // their direct reports' tasks.
  const [tasks, members, projects, reportsRes] = await Promise.all([
    listTasks({ workspaceId: workspace.id }),
    getWorkspaceMembers(workspace.id),
    listProjectOptions(workspace.id),
    supabase.from("daily_reports").select("user_id").eq("workspace_id", workspace.id).eq("report_date", today),
  ]);
  if (reportsRes.error) throw new Error("Failed to load daily updates");

  const active = members.filter((m) => m.isActive);
  const visibleAssignees = new Set(tasks.flatMap((t) => t.assignees.map((a) => a.userId)));
  // Admins: themselves, their direct reports, and anyone on work they can see.
  const employees = active.filter(
    (m) => isSuperAdmin || m.userId === me || m.managerId === me || visibleAssignees.has(m.userId),
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
    new Set(reportsRes.data.map((r) => r.user_id)),
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
  const totals = teamTotals(rows);
  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
  }));

  return (
    <>
      <PageHeader
        title="Team Today"
        description={`${formatDate(today)} · ${isSuperAdmin ? "everyone in" : "your team in"} ${workspace.name}`}
        actions={<NewTaskButton projects={projects} members={memberOptions} workspaceId={workspace.id} label="Assign task" />}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Planned today" value={totals.planned} icon={Sun} tone="info" />
        <StatCard label="Done today" value={totals.completed} icon={CheckCircle2} tone="success" />
        <StatCard label="Pending" value={totals.pending} icon={ListTodo} />
        <StatCard label="Carried forward" value={totals.carriedForward} icon={History} />
        <StatCard label="Overdue" value={totals.overdue} icon={AlertTriangle} tone={totals.overdue ? "danger" : "default"} />
        <StatCard label="Blocked" value={totals.blocked} icon={Ban} tone={totals.blocked ? "danger" : "default"} />
        <StatCard label={`Updates (${rows.length})`} value={totals.reportsSubmitted} icon={FileCheck} />
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Team progress today: {totals.progress}% · counts are per assignee, so shared tasks count for each person.
      </p>
      <TeamTodayTable rows={rows} tasksByUser={tasksByUser} today={today} />
    </>
  );
}
