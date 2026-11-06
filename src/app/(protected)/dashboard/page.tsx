import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  CheckSquare,
  CircleDot,
  ClipboardCheck,
  FolderKanban,
  ListTodo,
  Sun,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { PriorityBadge, ProgressBar, ProjectStatusBadge, StatusBadge } from "@/components/app/badges";
import { PageHeader, Section, sectionLinkClass } from "@/components/app/page-header";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  CompactTaskList,
  ProjectProgressList,
  StatCard,
} from "@/components/dashboard/widgets";
import { ProjectFormButton } from "@/components/projects/project-form-dialog";
import { ApproveTaskButton } from "@/components/tasks/approve-task-button";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TeamTodayPanel } from "@/components/team/team-today-panel";
import { buttonVariants } from "@/components/ui/button";
import type { Session } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { listClients } from "@/lib/data/clients";
import { loadDailyTracking } from "@/lib/data/daily-tracking-data";
import { summarizeTracking } from "@/lib/daily-tracking";
import { loadError } from "@/lib/data/errors";
import { loadTeamToday } from "@/lib/data/team-today-data";
import { listProjectOptions, listProjects, type ProjectSummary } from "@/lib/data/projects";
import { listTasks, type TaskSummary } from "@/lib/data/tasks";
import { canCreateProjects, getMyWorkspaces, getWorkspaceMembers, type Member, type Workspace, workspaceToday } from "@/lib/data/workspace";
import { BUSINESS_TIMEZONE, PRIORITY_RANK, addDaysISO, displayName, formatDate, formatDateTime, isOverdue, todayISO } from "@/lib/domain";
import { buildRangeReport } from "@/lib/data/hr-month";
import { listLeaveForReview } from "@/lib/data/hr";
import { dashboardCounts, type DashboardCounts } from "@/lib/hr/report";
import { isCompletedOn, isInTodaysWorkload } from "@/lib/scheduling";
import {
  departmentProgress,
  inDateRange,
  employeeCounts,
  employeePerformance,
  projectProgress,
  statusCounts,
  type DateRange,
} from "@/lib/super-admin-overview";
import { createClient } from "@/lib/supabase/server";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Dashboard" };

const isOpen = (t: TaskSummary) => t.status !== "COMPLETED" && t.status !== "CANCELLED";

// Pure calendar arithmetic on YYYY-MM-DD; independent of the server timezone.
const addDays = addDaysISO;

const byDue = (a: TaskSummary, b: TaskSummary) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ?from=&to= for the super admin performance figures; one date alone means that day. */
function parseRange(from: unknown, to: unknown): DateRange | null {
  const f = typeof from === "string" && ISO_DATE.test(from) ? from : null;
  const t = typeof to === "string" && ISO_DATE.test(to) ? to : null;
  if (!f && !t) return null;
  const a = f ?? t!;
  const b = t ?? f!;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const isAdmin = session.profile.role === "ADMIN";
  const isIndividual = session.profile.role === "INDIVIDUAL";
  const [tasks, projects, members, team, projectOptions, myReport, tracking, canCreate, clients] = await Promise.all([
    listTasks({ workspaceId: workspace.id }),
    listProjects(workspace.id),
    getWorkspaceMembers(workspace.id),
    isAdmin ? loadTeamToday(session, workspace) : Promise.resolve(null),
    // Options for the existing New task dialog (admins only).
    isAdmin ? listProjectOptions(workspace.id) : Promise.resolve([]),
    isIndividual ? myReportToday(workspace.id, session.user.id, workspaceToday(workspace)) : Promise.resolve(null),
    // Automatic morning report vs. live tasks (migration 011), super admins only.
    isSuperAdmin ? loadDailyTracking(workspace.id, workspaceToday(workspace)) : Promise.resolve({ rows: [], reports: [] }),
    // Add project on the admin dashboard: same rule as the Projects page; createProject and RLS enforce it again.
    isAdmin ? canCreateProjects(workspace.id, session.user.id, session.profile.role) : Promise.resolve(false),
    // RLS-scoped to the active workspace, so the picker lists only clients the admin can attach a project to.
    isAdmin ? listClients(workspace.id) : Promise.resolve([]),
  ]);

  const name = session.profile.fullName?.split(" ")[0] || session.profile.email || "there";
  const props = { session, workspace, tasks, projects, members, today: workspaceToday(workspace) };

  if (isSuperAdmin) {
    // Company-wide figures (super admins read every workspace, 025).
    const params = await searchParams;
    const range = parseRange(params.from, params.to);
    // Today's attendance from the same source and rules as /hr (company-wide, India time).
    const attendanceDay = todayISO(new Date(), BUSINESS_TIMEZONE);
    const workspaces = await getMyWorkspaces();
    const [attendanceReport, pendingLeave] = await Promise.all([
      buildRangeReport(attendanceDay, attendanceDay),
      // Same query as HR → Leave Applications (pending, this year).
      listLeaveForReview("PENDING", Number(attendanceDay.slice(0, 4))),
    ]);
    const attendance = dashboardCounts(attendanceReport.reports.filter((r) => r.employee.isActive).map((r) => r.days[0]));
    return (
      <SuperAdminDashboard
        {...props}
        range={range}
        attendance={attendance}
        name={name}
        tracking={tracking}
        workspaces={workspaces}
        pendingLeave={pendingLeave}
      />
    );
  }

  if (isAdmin && team) {
    return (
      <AdminDashboard
        {...props}
        name={name}
        team={team}
        projectOptions={projectOptions}
        clientOptions={clients.map((c) => ({ id: c.id, name: c.name }))}
        clients={canCreate ? clients.map((c) => ({ id: c.id, name: c.name })) : null}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={`Welcome back, ${name}`}
        description={`${ROLE_LABELS[session.profile.role]} · ${workspace.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/my-day" className={buttonVariants({ variant: "outline", size: "sm", className: "h-8" })}>
              <Sun aria-hidden="true" /> My Day
            </Link>
            <Link href="/tasks" className={buttonVariants({ variant: "outline", size: "sm", className: "h-8" })}>
              <CheckSquare aria-hidden="true" /> My Tasks
            </Link>
            {/* Individuals granted client and project creation (028). */}
            {members.find((m) => m.userId === session.user.id)?.canCreateClientsProjects ? (
              <>
                <Link href="/clients" className={buttonVariants({ variant: "outline", size: "sm", className: "h-8" })}>
                  Clients
                </Link>
                <Link href="/projects" className={buttonVariants({ variant: "outline", size: "sm", className: "h-8" })}>
                  Projects
                </Link>
              </>
            ) : null}
          </div>
        }
      />
      {team ? (
        <Section title={`Today — employee progress (${team.rows.length})`} className="mb-6">
          <TeamTodayPanel rows={team.rows} tasksByUser={team.tasksByUser} totals={team.totals} today={team.today} />
        </Section>
      ) : null}
      <IndividualDashboard {...props} report={myReport} timeZone={workspace.timezone} />
    </>
  );
}

type Props = {
  session: Session;
  workspace: Workspace;
  tasks: TaskSummary[];
  projects: ProjectSummary[];
  members: Member[];
  today: string;
};

type SuperAdminProps = Props & {
  range: DateRange | null;
  attendance: DashboardCounts;
  name: string;
  tracking: Awaited<ReturnType<typeof loadDailyTracking>>;
  workspaces: Awaited<ReturnType<typeof getMyWorkspaces>>;
  pendingLeave: Awaited<ReturnType<typeof listLeaveForReview>>;
};


/**
 * Super admin: monitoring-only company dashboard (layout of the approved
 * reference, 2026-11-06). Every figure comes from the existing calculations in
 * lib/super-admin-overview and the existing report / attendance / leave data.
 * No task-creation actions and no meetings here (meetings: Team Today).
 */
function SuperAdminDashboard({ workspace, tasks, projects, members, today, name, tracking, range, attendance, workspaces, pendingLeave }: SuperAdminProps) {
  // Admins and Individuals who are active (super admins review; they do not report).
  const employees = members
    .filter((m) => m.role !== "SUPER_ADMIN" && m.isActive)
    .map((m) => ({ userId: m.userId, name: displayName({ full_name: m.fullName, email: m.email }), team: m.team?.trim() || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const summaries = new Map(summarizeTracking(employees.map((e) => e.userId), tracking.rows, tracking.reports).map((s) => [s.userId, s]));
  const reportsBy = new Map(tracking.reports.map((r) => [r.userId, r]));
  const morningDone = employees.filter((e) => reportsBy.get(e.userId)?.morningSubmittedAt).length;
  const eveningDone = employees.filter((e) => reportsBy.get(e.userId)?.eveningSubmittedAt).length;

  // Each piece of work counted once (parents through their subtasks, cancelled excluded).
  const counts = statusCounts(tasks, today);
  const people = employeeCounts(members);
  const completionPercent = counts.total ? Math.round((counts.completed / counts.total) * 100) : 0;
  const performance = employeePerformance(tasks, members, today, range, workspace.timezone).sort((a, b) => b.total - a.total);
  const departments = departmentProgress(tasks, members, range, workspace.timezone);
  // Same date rule as the performance figures (due / scheduled / completed in the range).
  const projectStatus = new Map(projects.map((p) => [p.id, p.status]));
  const projectRows = projectProgress(projects, tasks.filter((t) => inDateRange(t, range, workspace.timezone)), today);
  const rangeLabel = range ? `${formatDate(range.from)} – ${formatDate(range.to)}` : "All time";
  const presets = [
    { label: "Last 15 days", from: addDays(today, -14), to: today },
    { label: "Last 30 days", from: addDays(today, -29), to: today },
  ];
  const head = "text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

  return (
    <>
      <PageHeader
        title={`${greeting(workspace.timezone)}, ${name}`}
        description={`Here's what's happening across Channel I'm · ${formatDate(today)}`}
        actions={
          <div className="w-full sm:w-64">
            <WorkspaceSwitcher workspaces={workspaces} activeId={workspace.id} />
          </div>
        }
      />

      {/* 1. Summary of the selected workspace; each card opens the matching list. */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total employees" value={people.admins + people.individuals} icon={Users} tone="brand" hint={`${people.admins} Admin · ${people.individuals} Individual`} href="/team?active=active" />
        <StatCard label="Total tasks" value={counts.total} icon={ListTodo} tone="info" hint={workspace.name} href="/tasks?scope=all" />
        <StatCard label="Completed" value={counts.completed} icon={CheckCircle2} tone="success" hint={`${completionPercent}% completion`} href="/tasks?scope=all&status=COMPLETED" />
        <StatCard label="In progress" value={counts.inProgress} icon={CircleDot} tone="violet" hint={`${counts.pending} not started`} href="/tasks?scope=all&status=IN_PROGRESS" />
        <StatCard label="Overdue" value={counts.overdue} icon={AlertTriangle} tone={counts.overdue ? "danger" : "default"} hint={`${counts.blocked} blocked`} href="/tasks?scope=all&sort=due" />
      </div>

      {/* Date filter for the department, employee, total-work and client/project figures. */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-card px-4 py-3 shadow-card">
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="mr-1 text-sm font-medium">{rangeLabel}</span>
        <Link href="/dashboard" className={cn(chip, !range && chipActive)}>
          All time
        </Link>
        {presets.map((p) => (
          <Link key={p.label} href={`/dashboard?from=${p.from}&to=${p.to}`} className={cn(chip, range?.from === p.from && range?.to === p.to && chipActive)}>
            {p.label}
          </Link>
        ))}
        <form action="/dashboard" className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Input type="date" name="from" defaultValue={range?.from ?? ""} aria-label="From" className="h-8 w-[9.5rem] text-sm" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" name="to" defaultValue={range?.to ?? ""} aria-label="To" className="h-8 w-[9.5rem] text-sm" />
          <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Apply
          </button>
        </form>
      </div>

      {/* 2 · 3 · 7 */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Section title="Department progress" icon={BarChart3} description={`${workspace.name} · ${rangeLabel}`}>
          {departments.length ? (
            <ul className="grid gap-3.5">
              {departments.map((d, i) => (
                <li key={d.department} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--chart-${(i % 5) + 1})` }} aria-hidden="true" />
                    <span className="truncate font-medium">{d.department}</span>
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {d.completed} / {d.total}
                  </span>
                  <span className="col-span-2 flex items-center gap-2">
                    <ProgressBar value={d.completionPercent} />
                    <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums">{d.completionPercent}%</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No active employees yet.</p>
          )}
        </Section>

        <Section
          title="Team attendance"
          icon={CalendarDays}
          description="Today · all workspaces"
          action={
            <Link href="/hr" className={sectionLinkClass}>
              View details →
            </Link>
          }
        >
          <AttendanceDonut attendance={attendance} />
        </Section>

        <Section
          title={`Pending leave applications (${pendingLeave.length})`}
          icon={CalendarOff}
          className="lg:col-span-2 xl:col-span-1"
          action={
            <Link href="/hr/leave" className={sectionLinkClass}>
              View all →
            </Link>
          }
        >
          {pendingLeave.length ? (
            <ul className="-my-1 divide-y divide-border/70">
              {pendingLeave.slice(0, 5).map((l) => {
                // Whole days the application has waited, by workspace date.
                const waiting = Math.max(0, Math.round((Date.parse(today) - Date.parse(l.createdAt.slice(0, 10))) / 86400000));
                return (
                  <li key={l.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-soft-foreground">
                      {initials(l.applicant.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.applicant.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[l.applicant.department, `${formatDate(l.start)}${l.end !== l.start ? ` – ${formatDate(l.end)}` : ""}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Badge variant={waiting >= 2 ? "danger" : "warning"} title="Waiting for a decision">
                      {waiting === 0 ? "Today" : `${waiting} day${waiting === 1 ? "" : "s"}`}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No applications waiting for a decision.</p>
          )}
        </Section>
      </div>

      {/* 4 · 5 */}
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Section
          title="Daily updates"
          icon={ClipboardCheck}
          description={`Today · ${morningDone}/${employees.length} morning plans · ${eveningDone}/${employees.length} evening reports`}
          action={
            <Link href="/reports" className={sectionLinkClass}>
              View all →
            </Link>
          }
        >
          <Tabs defaultValue="morning">
            <TabsList className="mb-3">
              <TabsTrigger value="morning">Morning plans</TabsTrigger>
              <TabsTrigger value="evening">Evening reports</TabsTrigger>
              <TabsTrigger value="status">Status</TabsTrigger>
            </TabsList>
            <TabsContent value="morning">
              <ReportTable
                rows={employees.map((e) => ({ ...e, detail: `${summaries.get(e.userId)?.morning ?? 0} planned · ${summaries.get(e.userId)?.added ?? 0} added`, at: reportsBy.get(e.userId)?.morningSubmittedAt ?? null }))}
                detailHead="Morning plan"
              />
            </TabsContent>
            <TabsContent value="evening">
              <ReportTable
                rows={employees.map((e) => {
                  const r = reportsBy.get(e.userId);
                  const s = summaries.get(e.userId);
                  return { ...e, detail: `${s?.completed ?? 0} done · ${s?.inProgress ?? 0} in progress${r?.blockers ? " · blocker reported" : ""}`, at: r?.eveningSubmittedAt ?? null };
                })}
                detailHead="Evening report"
              />
            </TabsContent>
            <TabsContent value="status">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: "Morning plans submitted", value: morningDone, tone: "text-success-foreground" },
                  { label: "Morning plans pending", value: employees.length - morningDone, tone: "text-warning-foreground" },
                  { label: "Evening reports submitted", value: eveningDone, tone: "text-success-foreground" },
                  { label: "Evening reports pending", value: employees.length - eveningDone, tone: "text-warning-foreground" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border/70 p-3">
                    <dt className="text-xs text-muted-foreground">{s.label}</dt>
                    <dd className={cn("text-xl font-semibold tabular-nums", s.tone)}>{s.value}</dd>
                  </div>
                ))}
              </dl>
            </TabsContent>
          </Tabs>
        </Section>

        <Section
          title="Employee performance"
          icon={Users}
          description={`${workspace.name} · ${rangeLabel}`}
          action={
            <Link href="/team" className={sectionLinkClass}>
              View all →
            </Link>
          }
        >
          {performance.length ? (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[28rem] text-sm">
                <thead className={head}>
                  <tr className="border-b border-border/70">
                    <th className="px-4 py-2 font-medium sm:px-5">Employee</th>
                    <th className="px-3 py-2 font-medium">Department</th>
                    <th className="px-3 py-2 text-right font-medium">Total work</th>
                    <th className="px-4 py-2 font-medium sm:px-5">Completion</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {performance.slice(0, 8).map((p) => (
                    <tr key={p.userId}>
                      <td className="px-4 py-2.5 font-medium sm:px-5">
                        <span className="flex items-center gap-2">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand-soft-foreground">{initials(p.name)}</span>
                          <span className="truncate">{p.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{p.department ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.total}</td>
                      <td className="px-4 py-2.5 sm:px-5">
                        <span className="flex items-center gap-2">
                          <ProgressBar value={p.completionPercent} className="w-20 [&>div]:bg-success" />
                          <span className="w-9 text-right text-xs font-medium tabular-nums">{p.completionPercent}%</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active employees yet.</p>
          )}
        </Section>
      </div>

      {/* 6 · 8 */}
      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          title="Client & project progress"
          icon={FolderKanban}
          description={`${projectRows.length} project${projectRows.length === 1 ? "" : "s"} · ${rangeLabel}`}
          action={
            <Link href="/projects" className={sectionLinkClass}>
              View all →
            </Link>
          }
        >
          {projectRows.length ? (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[30rem] text-sm">
                <thead className={head}>
                  <tr className="border-b border-border/70">
                    <th className="px-4 py-2 font-medium sm:px-5">Client</th>
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Progress</th>
                    <th className="px-4 py-2 font-medium sm:px-5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {projectRows.slice(0, 8).map((r) => {
                    const pct = r.total ? Math.round((r.completed / r.total) * 100) : 0;
                    return (
                      <tr key={r.project.id}>
                        <td className="px-4 py-2.5 text-muted-foreground sm:px-5">{r.project.clientName ?? "Internal"}</td>
                        <td className="max-w-[12rem] truncate px-3 py-2.5 font-medium">
                          <Link href={`/projects/${r.project.id}`} className="hover:underline">
                            {r.project.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <ProgressBar value={pct} className="w-20" />
                            <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                              {r.completed}/{r.total}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 sm:px-5">
                          {projectStatus.get(r.project.id) ? <ProjectStatusBadge status={projectStatus.get(r.project.id)!} /> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No projects in this workspace yet.</p>
          )}
        </Section>

        <Section
          title="Total work"
          icon={ListTodo}
          description={`Per employee · ${rangeLabel}`}
          action={
            <Link href="/tasks?scope=all" className={sectionLinkClass}>
              View all →
            </Link>
          }
        >
          {performance.length ? (
            <div className="-mx-4 overflow-x-auto sm:-mx-5">
              <table className="w-full min-w-[28rem] text-sm">
                <thead className={head}>
                  <tr className="border-b border-border/70">
                    <th className="px-4 py-2 font-medium sm:px-5">Employee</th>
                    <th className="px-3 py-2 text-right font-medium">Tasks</th>
                    <th className="px-3 py-2 text-right font-medium">Completed</th>
                    <th className="px-3 py-2 text-right font-medium">In progress</th>
                    <th className="px-4 py-2 text-right font-medium sm:px-5">Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {performance.slice(0, 8).map((p) => (
                    <tr key={p.userId}>
                      <td className="max-w-[10rem] truncate px-4 py-2.5 font-medium sm:px-5">{p.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.total}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-success-foreground">{p.completed}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{p.inProgress}</td>
                      <td className={cn("px-4 py-2.5 text-right tabular-nums sm:px-5", p.overdue ? "font-semibold text-danger-foreground" : "text-muted-foreground")}>{p.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active employees yet.</p>
          )}
        </Section>
      </div>
    </>
  );
}

const chip = "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";
const chipActive = "border-primary/30 bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** Today's report status per employee, for one report type. */
function ReportTable({ rows, detailHead }: { rows: { userId: string; name: string; team: string | null; detail: string; at: string | null }[]; detailHead: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No active employees yet.</p>;
  return (
    <div className="-mx-4 max-h-80 overflow-auto sm:-mx-5">
      <table className="w-full min-w-[28rem] text-sm">
        <thead className="sticky top-0 bg-card text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          <tr className="border-b border-border/70">
            <th className="px-4 py-2 font-medium sm:px-5">Employee</th>
            <th className="px-3 py-2 font-medium">{detailHead}</th>
            <th className="px-4 py-2 text-right font-medium sm:px-5">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((r) => (
            <tr key={r.userId}>
              <td className="px-4 py-2.5 sm:px-5">
                <Link href={`/reports?employee=${r.userId}`} className="block truncate font-medium hover:underline">
                  {r.name}
                </Link>
                <span className="block truncate text-xs text-muted-foreground">{r.team ?? "No department"}</span>
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.detail}</td>
              <td className="px-4 py-2.5 text-right sm:px-5">
                <Badge variant={r.at ? "success" : "warning"}>{r.at ? "Submitted" : "Pending"}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Present / on leave / absent (plus not checked in) as a ring, from the HR attendance counts. */
function AttendanceDonut({ attendance }: { attendance: DashboardCounts }) {
  const parts = [
    { label: "Present", value: attendance.present, color: "var(--success)", hint: attendance.wfh ? `incl. ${attendance.wfh} WFH` : null },
    { label: "On leave", value: attendance.onLeave, color: "var(--warning)", hint: null },
    { label: "Absent", value: attendance.absent, color: "var(--danger)", hint: null },
    { label: "Not checked in", value: attendance.notCheckedIn, color: "var(--neutral)", hint: null },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col 2xl:flex-row">
      <div className="relative size-36 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={`${attendance.present} of ${total} present`}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--muted)" strokeWidth="11" />
          {total
            ? parts.map((p) => {
                const len = (p.value / total) * c;
                const el = <circle key={p.label} cx="50" cy="50" r={r} fill="none" stroke={p.color} strokeWidth="11" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
                offset += len;
                return el;
              })
            : null}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums">{attendance.present}</span>
          <span className="text-xs text-muted-foreground">Present</span>
        </span>
      </div>
      <ul className="grid w-full gap-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            <span className="flex-1">
              {p.label}
              {p.hint ? <span className="ml-1 text-xs text-muted-foreground">({p.hint})</span> : null}
            </span>
            <span className="font-semibold tabular-nums">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Good morning" etc. in the workspace's own timezone. */
function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

type AdminProps = Props & {
  name: string;
  team: Awaited<ReturnType<typeof loadTeamToday>>;
  projectOptions: Awaited<ReturnType<typeof listProjectOptions>>;
  /** Every client of the workspace, for the New task dialog. */
  clientOptions: { id: string; name: string }[];
  /** Clients for Add project; null when the admin may not create projects in this workspace. */
  clients: { id: string; name: string }[] | null;
};

/** One task line: title, where it belongs, who it is with, due date and status. */
function TaskLine({
  task,
  me,
  today,
  action,
  showPriority = false,
}: {
  task: TaskSummary;
  me: string;
  today: string;
  action?: ReactNode;
  showPriority?: boolean;
}) {
  const overdue = isOverdue(task.dueDate, task.status, today);
  const others = task.assignees.filter((a) => a.userId !== me).map((a) => a.fullName || a.email || "Unknown");
  const where = [task.clientName, task.projectName].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <Link href={`/tasks/${task.id}`} className="block truncate text-sm font-medium hover:underline">
          {task.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {[where, others.length ? `with ${others.join(", ")}` : null].filter(Boolean).join(" · ") || "No project"}
        </p>
      </div>
      {task.dueDate ? (
        <span className={`hidden shrink-0 text-xs sm:inline ${overdue ? "font-medium text-red-600" : "text-muted-foreground"}`}>
          {overdue ? "Overdue · " : "Due "}
          {formatDate(task.dueDate)}
        </span>
      ) : null}
      {showPriority ? <PriorityBadge priority={task.priority} className="shrink-0" /> : null}
      <StatusBadge status={task.status} className="shrink-0" />
      {action}
    </li>
  );
}

/**
 * Admin: personal work and work handed out to others, side by side; team
 * progress below. Creating a task uses the existing New task dialog.
 */
function AdminDashboard({ session, workspace, tasks, projects, members, today, name, team, projectOptions, clientOptions, clients }: AdminProps) {
  const me = session.user.id;
  const handedOut = (t: TaskSummary) =>
    (t.createdBy === me || t.assignees.some((a) => a.assignedBy === me)) && t.assignees.some((a) => a.userId !== me);
  const overdueFirst = (a: TaskSummary, b: TaskSummary) =>
    Number(isOverdue(b.dueDate, b.status, today)) - Number(isOverdue(a.dueDate, a.status, today)) || byDue(a, b);

  // Personal: my open tasks that belong to today (scheduled, due or carried) or are overdue.
  const myToday = tasks
    .filter((t) => isOpen(t) && t.assignees.some((a) => a.userId === me))
    .filter((t) => isInTodaysWorkload(t, today) || isOverdue(t.dueDate, t.status, today))
    .sort(overdueFirst);
  // Delegated: open work I created or assigned to someone else (review items are listed separately).
  const assignedByMe = tasks.filter((t) => isOpen(t) && t.status !== "IN_REVIEW" && handedOut(t)).sort(overdueFirst);
  const delegatedOverdue = assignedByMe.filter((t) => isOverdue(t.dueDate, t.status, today)).length;
  // Awaiting review: work I handed out that is now IN_REVIEW. Approve is re-checked on the server.
  const awaitingReview = tasks.filter((t) => t.status === "IN_REVIEW" && handedOut(t)).sort(byDue);

  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
    team: m.team,
  }));
  const owners = memberOptions.filter((m) => m.isActive).map((m) => ({ userId: m.userId, name: m.name }));
  const quickLink = buttonVariants({ variant: "outline", size: "sm", className: "h-8" });
  const textLink = "text-xs text-muted-foreground hover:text-foreground hover:underline";

  return (
    <>
      <PageHeader
        title={`Welcome back, ${name}`}
        description={`${ROLE_LABELS[session.profile.role]} · ${workspace.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <NewTaskButton projects={projectOptions} clients={clientOptions} members={memberOptions} workspaceId={workspace.id} size="sm" />
            {clients ? (
              <ProjectFormButton
                mode="create"
                workspaceId={workspace.id}
                owners={owners}
                clients={clients}
                requireClient
                stayOnPage
                size="sm"
              />
            ) : null}
            <Link href="/my-day" className={quickLink}>
              <Sun aria-hidden="true" /> My Day
            </Link>
            <Link href="/tasks" className={quickLink}>
              <CheckSquare aria-hidden="true" /> My Tasks
            </Link>
          </div>
        }
      />


      {awaitingReview.length ? (
        <Section
          title={`Awaiting your review (${awaitingReview.length})`}
          className="mb-6"
          action={
            <Link href="/tasks?scope=all&status=IN_REVIEW" className={textLink}>
              All in review
            </Link>
          }
        >
          <p className="mb-2 text-xs text-muted-foreground">
            Work you handed out that is ready for review. Approve marks it completed.
          </p>
          <ul className="-my-2 divide-y">
            {awaitingReview.slice(0, 10).map((t) => (
              <TaskLine key={t.id} task={t} me={me} today={today} action={<ApproveTaskButton taskId={t.id} title={t.title} />} />
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Section
          title={`My work today (${myToday.length})`}
          action={
            <Link href="/my-day" className={textLink}>
              Open My Day
            </Link>
          }
        >
          {myToday.length ? (
            <ul className="-my-2 divide-y">
              {myToday.slice(0, 8).map((t) => (
                <TaskLine key={t.id} task={t} me={me} today={today} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing due or planned for you today.</p>
          )}
          {myToday.length > 8 ? (
            <Link href="/my-day" className={`${textLink} mt-3 inline-block`}>
              {myToday.length - 8} more in My Day
            </Link>
          ) : null}
        </Section>
        <Section
          title={`Assigned by you (${assignedByMe.length}${delegatedOverdue ? ` · ${delegatedOverdue} overdue` : ""})`}
          action={
            <Link href="/tasks?scope=created" className={textLink}>
              View all
            </Link>
          }
        >
          {assignedByMe.length ? (
            <ul className="-my-2 divide-y">
              {assignedByMe.slice(0, 8).map((t) => (
                <TaskLine key={t.id} task={t} me={me} today={today} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No open work assigned to others. Use New task to assign some.</p>
          )}
        </Section>
      </div>

      <Section
        title={`Team today (${team.rows.length})`}
        className="mb-6"
        action={
          <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
            <Link href="/reports" className={textLink}>
              Daily reports
            </Link>
            <Link href="/team-today" className={textLink}>
              Team Today
            </Link>
          </span>
        }
      >
        <TeamTodayPanel rows={team.rows} tasksByUser={team.tasksByUser} totals={team.totals} today={team.today} />
      </Section>

      <Section
        title="Projects"
        action={
          <Link href="/projects" className={textLink}>
            View all
          </Link>
        }
      >
        <ProjectProgressList projects={projects.slice(0, 6)} empty="No projects yet." />
      </Section>
    </>
  );
}

/** The signed-in user's own report row for today (submission flags only). */
async function myReportToday(workspaceId: string, userId: string, today: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_reports")
    .select("morning_submitted_at, evening_submitted_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("report_date", today)
    .maybeSingle();
  if (error) throw loadError("Failed to load your daily update", error);
  return data;
}

type IndividualProps = Props & {
  report: { morning_submitted_at: string | null; evening_submitted_at: string | null } | null;
  timeZone: string;
};

/**
 * Individual: today's work first (same date rules as My Day), the daily
 * update status next to it, then what is coming up and project progress.
 */
function IndividualDashboard({ session, tasks, projects, today, report, timeZone }: IndividualProps) {
  const me = session.user.id;
  const mine = tasks.filter((t) => t.assignees.some((a) => a.userId === me));
  // Today's work: scheduled today, carried forward, due today (unscheduled) or overdue.
  const todays = mine
    .filter((t) => isOpen(t) && (isInTodaysWorkload(t, today) || isOverdue(t.dueDate, t.status, today)))
    .sort(
      (a, b) =>
        Number(isOverdue(b.dueDate, b.status, today)) - Number(isOverdue(a.dueDate, a.status, today)) ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        byDue(a, b),
    );
  const overdueCount = todays.filter((t) => isOverdue(t.dueDate, t.status, today)).length;
  const urgentCount = todays.filter((t) => t.priority === "URGENT" || t.priority === "HIGH").length;
  const doneToday = mine.filter((t) => t.status === "COMPLETED" && isCompletedOn(t.completedAt, today, timeZone)).length;
  const todayProgress = todays.length + doneToday ? Math.round((doneToday / (todays.length + doneToday)) * 100) : 0;
  const weekEnd = addDays(today, 7);
  const upcoming = mine
    .filter((t) => isOpen(t) && t.dueDate && t.dueDate > today && t.dueDate <= weekEnd)
    .sort(byDue);
  const myProjectIds = new Set(mine.map((t) => t.projectId));
  const myProjects = projects.filter((p) => myProjectIds.has(p.id));
  const textLink = "text-xs text-muted-foreground hover:text-foreground hover:underline";

  return (
    <div className="grid gap-6">
      {/* Today in one line */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
        <span className="font-medium">Today</span>
        <span>
          <span className="font-semibold tabular-nums">{todays.length}</span> to do
        </span>
        <span className={overdueCount ? "text-red-600" : undefined}>
          <span className="font-semibold tabular-nums">{overdueCount}</span> overdue
        </span>
        <span>
          <span className="font-semibold tabular-nums">{urgentCount}</span> high priority
        </span>
        <span className="text-emerald-700">
          <span className="font-semibold tabular-nums">{doneToday}</span> done today
        </span>
        <span className="flex min-w-40 flex-1 items-center gap-2 sm:max-w-56 sm:ml-auto">
          <ProgressBar value={todayProgress} />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{todayProgress}%</span>
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section
          title={`Today's work (${todays.length})`}
          className="lg:col-span-2"
          action={
            <Link href="/my-day" className={textLink}>
              Open My Day
            </Link>
          }
        >
          {todays.length ? (
            <ul className="-my-2 divide-y">
              {todays.slice(0, 10).map((t) => (
                <TaskLine key={t.id} task={t} me={me} today={today} showPriority />
              ))}
            </ul>
          ) : (
            <div className="grid gap-1 py-2">
              <p className="text-sm font-medium">You&apos;re all caught up for today.</p>
              <p className="text-sm text-muted-foreground">
                Nothing is scheduled, due or overdue. Plan ahead in <Link href="/my-day" className="underline">My Day</Link> or browse{" "}
                <Link href="/tasks" className="underline">My Tasks</Link>.
              </p>
            </div>
          )}
          {todays.length > 10 ? (
            <Link href="/my-day" className={`${textLink} mt-3 inline-block`}>
              {todays.length - 10} more in My Day
            </Link>
          ) : null}
        </Section>

        <Section title="Daily update">
          <ul className="grid gap-2 text-sm">
            <li className="flex items-center justify-between gap-2">
              <span>Morning plan</span>
              <span className={report?.morning_submitted_at ? "text-emerald-700" : "text-muted-foreground"}>
                {report?.morning_submitted_at ? `Submitted ${formatDateTime(report.morning_submitted_at)}` : "Not submitted"}
              </span>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>Evening report</span>
              <span className={report?.evening_submitted_at ? "text-emerald-700" : "text-muted-foreground"}>
                {report?.evening_submitted_at ? `Submitted ${formatDateTime(report.evening_submitted_at)}` : "Not submitted"}
              </span>
            </li>
          </ul>
          <Link href="/reports" className={buttonVariants({ variant: "outline", className: "mt-4 h-9 w-full" })}>
            {!report?.morning_submitted_at
              ? "Submit morning plan"
              : !report?.evening_submitted_at
                ? "Submit evening report"
                : "View or update today's report"}
          </Link>
        </Section>

        <Section title={`Due in the next 7 days (${upcoming.length})`} className="lg:col-span-2">
          <CompactTaskList tasks={upcoming.slice(0, 8)} today={today} empty="No upcoming deadlines." />
        </Section>
        <Section title="My projects">
          <ProjectProgressList projects={myProjects.slice(0, 6)} empty="You're not on any project tasks yet." />
        </Section>
      </div>
    </div>
  );
}
