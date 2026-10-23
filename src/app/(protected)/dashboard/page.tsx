import {
  CalendarDays,
  CheckSquare,
  Sun,
} from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { PriorityBadge, ProgressBar, StatusBadge } from "@/components/app/badges";
import { MeetingLinksCard } from "@/components/app/meeting-links-card";
import { PageHeader, Section } from "@/components/app/page-header";
import {
  CompactTaskList,
  ProjectProgressList,
} from "@/components/dashboard/widgets";
import { ApproveTaskButton } from "@/components/tasks/approve-task-button";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { DailyTrackingPanel } from "@/components/team/daily-tracking-panel";
import { TeamTodayPanel } from "@/components/team/team-today-panel";
import { buttonVariants } from "@/components/ui/button";
import type { Session } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { listClients, type Client } from "@/lib/data/clients";
import { loadDailyTracking } from "@/lib/data/daily-tracking-data";
import { summarizeTracking } from "@/lib/daily-tracking";
import { loadError } from "@/lib/data/errors";
import { listMeetingLinks, meetingsForPerson } from "@/lib/data/meetings";
import { loadTeamToday } from "@/lib/data/team-today-data";
import { listProjectOptions, listProjects, type ProjectSummary } from "@/lib/data/projects";
import { listTasks, type TaskSummary } from "@/lib/data/tasks";
import { getWorkspaceMembers, type Member, type Workspace, workspaceToday } from "@/lib/data/workspace";
import { PRIORITY_RANK, addDaysISO, displayName, formatDate, formatDateTime, isOverdue } from "@/lib/domain";
import { combineProgress, isLeafTask } from "@/lib/progress";
import { isCompletedOn, isInTodaysWorkload } from "@/lib/scheduling";
import { createClient } from "@/lib/supabase/server";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Dashboard" };

const isOpen = (t: TaskSummary) => t.status !== "COMPLETED" && t.status !== "CANCELLED";

// Pure calendar arithmetic on YYYY-MM-DD; independent of the server timezone.
const addDays = addDaysISO;

const byDue = (a: TaskSummary, b: TaskSummary) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

export default async function DashboardPage() {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const isAdmin = session.profile.role === "ADMIN";
  const isIndividual = session.profile.role === "INDIVIDUAL";
  const [tasks, projects, members, team, meetings, clients, projectOptions, myReport, tracking] = await Promise.all([
    listTasks({ workspaceId: workspace.id }),
    listProjects(workspace.id),
    getWorkspaceMembers(workspace.id),
    isAdmin ? loadTeamToday(session, workspace) : Promise.resolve(null),
    listMeetingLinks(workspace.id, { activeOnly: true }),
    isSuperAdmin ? listClients(workspace.id) : Promise.resolve([] as Client[]),
    // Options for the existing New task dialog (admins only).
    isAdmin ? listProjectOptions(workspace.id) : Promise.resolve([]),
    isIndividual ? myReportToday(workspace.id, session.user.id, workspaceToday(workspace)) : Promise.resolve(null),
    // Automatic morning report vs. live tasks (migration 011), super admins only.
    isSuperAdmin ? loadDailyTracking(workspace.id, workspaceToday(workspace)) : Promise.resolve({ rows: [], reports: [] }),
  ]);

  const name = session.profile.fullName?.split(" ")[0] || session.profile.email || "there";
  const props = { session, workspace, tasks, projects, members, today: workspaceToday(workspace) };
  const meetingCard = (
    <MeetingLinksCard
      links={meetingsForPerson(meetings, session.profile.team, workspaceToday(workspace))}
      canManage={session.profile.role === "SUPER_ADMIN"}
    />
  );

  if (isSuperAdmin) {
    return (
      <SuperAdminDashboard
        {...props}
        name={name}
        tracking={tracking}
        clients={clients}
        meetingCard={meetingCard}
      />
    );
  }

  if (isAdmin && team) {
    return <AdminDashboard {...props} name={name} team={team} projectOptions={projectOptions} meetingCard={meetingCard} />;
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
          </div>
        }
      />
      <div className="mb-6">{meetingCard}</div>
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
  name: string;
  tracking: Awaited<ReturnType<typeof loadDailyTracking>>;
  clients: Client[];
  meetingCard: ReactNode;
};

/**
 * Super admin: summary first (company totals, today's team progress), details
 * on demand (expandable employee rows, client and overdue lists, links out).
 */
function SuperAdminDashboard({ session, workspace, tasks, projects, members, today, name, tracking, clients, meetingCard }: SuperAdminProps) {
  // Everyone active, plus anyone (e.g. deactivated today) who still has rows in today's report.
  const reported = new Set(tracking.rows.map((r) => r.userId));
  const employees = members
    .filter((m) => m.isActive || reported.has(m.userId))
    .map((m) => ({
      userId: m.userId,
      name: displayName({ full_name: m.fullName, email: m.email }),
      team: m.team,
      roleLabel: ROLE_LABELS[m.role],
      isActive: m.isActive,
    }))
    .sort((a, b) => (a.team ?? "~").localeCompare(b.team ?? "~") || a.name.localeCompare(b.name));
  const summaries = summarizeTracking(employees.map((e) => e.userId), tracking.rows, tracking.reports);

  // Company totals count each piece of work once: leaf tasks (a parent with
  // subtasks is counted through them), cancelled tasks excluded.
  const work = tasks.filter((t) => isLeafTask(t) && t.status !== "CANCELLED");
  const openWork = work.filter(isOpen);
  const completed = work.length - openWork.length;
  const overdue = openWork.filter((t) => isOverdue(t.dueDate, t.status, today)).sort(byDue);
  const recent = tasks.slice(0, 6);

  // Client progress: the same leaf counts as the Projects and Clients pages,
  // combined per client from the projects already loaded.
  const clientRows = [
    ...clients.map((c) => ({ id: c.id, name: c.name, list: projects.filter((p) => p.clientId === c.id) })),
    { id: null, name: "Internal / no client", list: projects.filter((p) => !p.clientId) },
  ]
    .filter((c) => c.list.length > 0)
    .map((c) => ({ ...c, ...combineProgress(c.list.map((p) => ({ total: p.totalTasks, completed: p.completedTasks }))) }));

  const quickLink = buttonVariants({ variant: "outline", size: "sm", className: "h-8" });
  const textLink = "text-xs text-muted-foreground hover:text-foreground hover:underline";

  return (
    <>
      <PageHeader
        title={`Welcome back, ${name}`}
        description={`${ROLE_LABELS[session.profile.role]} · ${workspace.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/my-day" className={quickLink}>
              <Sun aria-hidden="true" /> My Day
            </Link>
            <Link href="/tasks" className={quickLink}>
              <CheckSquare aria-hidden="true" /> My Tasks
            </Link>
            <Link href="/calendar" className={quickLink}>
              <CalendarDays aria-hidden="true" /> Calendar
            </Link>
          </div>
        }
      />

      {/* Company totals in one line; each figure opens the matching list. */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm">
        <span className="font-medium">Company</span>
        <Link href="/tasks?scope=all" className="hover:underline">
          <span className="font-semibold tabular-nums">{openWork.length}</span> open tasks
        </Link>
        <Link href="/tasks?scope=all&status=COMPLETED" className="hover:underline">
          <span className="font-semibold tabular-nums">{completed}</span> completed
        </Link>
        <Link href="/projects" className="hover:underline">
          <span className="font-semibold tabular-nums">{projects.length}</span> projects
        </Link>
        <Link href="/clients" className="hover:underline">
          <span className="font-semibold tabular-nums">{clients.length}</span> clients
        </Link>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          Each task counted once; a parent task counts through its subtasks.
        </span>
      </div>

      <div className="mb-6">{meetingCard}</div>

      <Section
        title={`Today's daily report — automatic (${employees.length})`}
        className="mb-6"
        action={
          <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
            <Link href="/reports" className={textLink}>
              Report history
            </Link>
            <Link href="/team" className={textLink}>
              All employees
            </Link>
          </span>
        }
      >
        <DailyTrackingPanel employees={employees} summaries={summaries} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Client progress"
          action={
            <Link href="/clients" className={textLink}>
              All clients
            </Link>
          }
        >
          {clientRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No client projects yet. Add clients and projects to track progress here.</p>
          ) : (
            <ul className="grid gap-3">
              {clientRows.slice(0, 8).map((c) => (
                <li key={c.id ?? "internal"}>
                  <Link href={c.id ? `/clients/${c.id}` : "/projects"} className="group grid gap-1.5">
                    <span className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium group-hover:underline">{c.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {c.completed}/{c.total} · {c.progress}%
                      </span>
                    </span>
                    <ProgressBar value={c.progress} />
                    <span className="text-xs text-muted-foreground">
                      {c.list.length} project{c.list.length === 1 ? "" : "s"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="grid content-start gap-6">
          <Section title={`Overdue tasks (${overdue.length})`}>
            <CompactTaskList tasks={overdue.slice(0, 6)} today={today} empty="Nothing overdue." showAssignee />
            {overdue.length > 6 ? (
              <Link href="/tasks?scope=all&sort=due" className={`${textLink} mt-3 inline-block`}>
                View all overdue work
              </Link>
            ) : null}
          </Section>
          <Section title="Recent task updates">
            <CompactTaskList tasks={recent} today={today} empty="No tasks yet." showAssignee />
          </Section>
        </div>
      </div>
    </>
  );
}

type AdminProps = Props & {
  name: string;
  team: Awaited<ReturnType<typeof loadTeamToday>>;
  projectOptions: Awaited<ReturnType<typeof listProjectOptions>>;
  meetingCard: ReactNode;
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
function AdminDashboard({ session, workspace, tasks, projects, members, today, name, team, projectOptions, meetingCard }: AdminProps) {
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
  const quickLink = buttonVariants({ variant: "outline", size: "sm", className: "h-8" });
  const textLink = "text-xs text-muted-foreground hover:text-foreground hover:underline";

  return (
    <>
      <PageHeader
        title={`Welcome back, ${name}`}
        description={`${ROLE_LABELS[session.profile.role]} · ${workspace.name}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <NewTaskButton projects={projectOptions} members={memberOptions} workspaceId={workspace.id} size="sm" />
            <Link href="/my-day" className={quickLink}>
              <Sun aria-hidden="true" /> My Day
            </Link>
            <Link href="/tasks" className={quickLink}>
              <CheckSquare aria-hidden="true" /> My Tasks
            </Link>
          </div>
        }
      />

      <div className="mb-6">{meetingCard}</div>

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
