import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  FolderKanban,
  ListTodo,
  Send,
  UserCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ProgressBar } from "@/components/app/badges";
import { MeetingLinksCard } from "@/components/app/meeting-links-card";
import { PageHeader, Section } from "@/components/app/page-header";
import {
  CompactTaskList,
  ProjectProgressList,
  StatCard,
  WorkloadTable,
  type Workload,
} from "@/components/dashboard/widgets";
import { TeamTodayPanel } from "@/components/team/team-today-panel";
import { buttonVariants } from "@/components/ui/button";
import type { Session } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { listMeetingLinks, meetingsForPerson } from "@/lib/data/meetings";
import { loadTeamToday } from "@/lib/data/team-today-data";
import { listProjects, type ProjectSummary } from "@/lib/data/projects";
import { listTasks, type TaskSummary } from "@/lib/data/tasks";
import { getWorkspaceMembers, type Member, type Workspace, workspaceToday } from "@/lib/data/workspace";
import { addDaysISO, displayName, isOverdue } from "@/lib/domain";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Dashboard" };

const isOpen = (t: TaskSummary) => t.status !== "COMPLETED" && t.status !== "CANCELLED";

// Pure calendar arithmetic on YYYY-MM-DD; independent of the server timezone.
const addDays = addDaysISO;

const byDue = (a: TaskSummary, b: TaskSummary) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");

function workload(members: Member[], tasks: TaskSummary[], today: string): Workload[] {
  return members
    .filter((m) => m.isActive)
    .map((m) => {
      const mine = tasks.filter((t) => t.assignees.some((a) => a.userId === m.userId));
      return {
        userId: m.userId,
        name: displayName({ full_name: m.fullName, email: m.email }),
        role: m.role,
        open: mine.filter(isOpen).length,
        overdue: mine.filter((t) => isOverdue(t.dueDate, t.status, today)).length,
        completed: mine.filter((t) => t.status === "COMPLETED").length,
      };
    })
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

export default async function DashboardPage() {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const showTeam = session.profile.role !== "INDIVIDUAL";
  const [tasks, projects, members, team, meetings] = await Promise.all([
    listTasks({ workspaceId: workspace.id }),
    listProjects(workspace.id),
    getWorkspaceMembers(workspace.id),
    showTeam ? loadTeamToday(session, workspace) : Promise.resolve(null),
    listMeetingLinks(workspace.id, { activeOnly: true }),
  ]);

  const name = session.profile.fullName?.split(" ")[0] || session.profile.email || "there";
  const props = { session, workspace, tasks, projects, members, today: workspaceToday(workspace) };

  return (
    <>
      <PageHeader
        title={`Welcome back, ${name}`}
        description={`${ROLE_LABELS[session.profile.role]} · ${workspace.name}`}
      />
      <div className="mb-6">
        <MeetingLinksCard
          links={meetingsForPerson(meetings, session.profile.team, workspaceToday(workspace))}
          canManage={session.profile.role === "SUPER_ADMIN"}
        />
      </div>
      {team ? (
        <Section title={`Today — employee progress (${team.rows.length})`} className="mb-6">
          <TeamTodayPanel rows={team.rows} tasksByUser={team.tasksByUser} totals={team.totals} today={team.today} />
        </Section>
      ) : null}
      {session.profile.role === "SUPER_ADMIN" ? (
        <SuperAdminDashboard {...props} />
      ) : session.profile.role === "ADMIN" ? (
        <AdminDashboard {...props} />
      ) : (
        <IndividualDashboard {...props} />
      )}
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

function SuperAdminDashboard({ tasks, projects, members, today }: Props) {
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS").length;
  const overdue = tasks.filter((t) => isOverdue(t.dueDate, t.status, today));
  const active = members.filter((m) => m.isActive);
  const counts = {
    admins: active.filter((m) => m.role !== "INDIVIDUAL").length,
    individuals: active.filter((m) => m.role === "INDIVIDUAL").length,
  };
  const recent = tasks.slice(0, 8);

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Projects" value={projects.length} icon={FolderKanban} href="/projects" />
        <StatCard label="Total tasks" value={tasks.length} icon={ListTodo} href="/tasks?scope=all" />
        <StatCard label="Completed" value={completed} icon={CheckCircle2} tone="success" href="/tasks?scope=all&status=COMPLETED" />
        <StatCard label="In progress" value={inProgress} icon={CircleDot} tone="info" href="/tasks?scope=all&status=IN_PROGRESS" />
        <StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone={overdue.length ? "danger" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Project progress"
          action={<Link href="/projects" className="text-xs text-muted-foreground hover:underline">View all</Link>}
        >
          <ProjectProgressList projects={projects.slice(0, 6)} empty="No projects yet. Create one from the Projects page." />
        </Section>
        <Section
          title={`Team overview · ${counts.admins} admin${counts.admins === 1 ? "" : "s"}, ${counts.individuals} individual${counts.individuals === 1 ? "" : "s"}`}
          action={<Link href="/team" className="text-xs text-muted-foreground hover:underline">Manage team</Link>}
        >
          <WorkloadTable rows={workload(members, tasks, today).slice(0, 8)} empty="No members in this workspace yet." />
        </Section>
        <Section title="Overdue tasks">
          <CompactTaskList tasks={overdue.sort(byDue).slice(0, 8)} today={today} empty="Nothing overdue. 🎉" showAssignee />
        </Section>
        <Section title="Recent task updates">
          <CompactTaskList tasks={recent} today={today} empty="No tasks yet." showAssignee />
        </Section>
      </div>
    </div>
  );
}

function AdminDashboard({ session, tasks, projects, members, today }: Props) {
  const me = session.user.id;
  const roleOf = new Map(members.map((m) => [m.userId, m.role]));
  const assignedToMe = tasks.filter((t) => t.assignees.some((a) => a.userId === me));
  const created = tasks.filter((t) => t.createdBy === me);
  // Delegated: tasks I created or assigned that have someone other than me on them.
  const delegated = tasks.filter(
    (t) =>
      isOpen(t) &&
      (t.createdBy === me || t.assignees.some((a) => a.assignedBy === me)) &&
      t.assignees.some((a) => a.userId !== me),
  );
  const toAdmins = delegated.filter((t) => t.assignees.some((a) => a.userId !== me && roleOf.get(a.userId) !== "INDIVIDUAL"));
  const toIndividuals = delegated.filter((t) => t.assignees.some((a) => roleOf.get(a.userId) === "INDIVIDUAL"));
  const overdue = tasks.filter((t) => isOverdue(t.dueDate, t.status, today));
  const weekEnd = addDays(today, 7);
  const upcoming = tasks.filter((t) => isOpen(t) && t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd).sort(byDue);

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Assigned to me (open)" value={assignedToMe.filter(isOpen).length} icon={UserCheck} href="/tasks" />
        <StatCard label="Created by me" value={created.length} icon={Send} href="/tasks?scope=created" />
        <StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone={overdue.length ? "danger" : "default"} />
        <StatCard label="Due in 7 days" value={upcoming.length} icon={CalendarClock} tone="info" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="My open tasks" action={<Link href="/tasks" className="text-xs text-muted-foreground hover:underline">View all</Link>}>
          <CompactTaskList tasks={assignedToMe.filter(isOpen).sort(byDue).slice(0, 8)} today={today} empty="Nothing assigned to you right now." />
        </Section>
        <Section title="Upcoming deadlines">
          <CompactTaskList tasks={upcoming.slice(0, 8)} today={today} empty="No deadlines in the next 7 days." showAssignee />
        </Section>
        <Section title={`Assigned to other admins (${toAdmins.length})`}>
          <CompactTaskList tasks={toAdmins.slice(0, 6)} today={today} empty="You haven't delegated work to other admins." showAssignee />
        </Section>
        <Section title={`Assigned to individuals (${toIndividuals.length})`}>
          <CompactTaskList tasks={toIndividuals.slice(0, 6)} today={today} empty="You haven't assigned work to individuals." showAssignee />
        </Section>
        <Section title="Overdue">
          <CompactTaskList tasks={overdue.sort(byDue).slice(0, 6)} today={today} empty="Nothing overdue. 🎉" showAssignee />
        </Section>
        <Section title="Projects" action={<Link href="/projects" className="text-xs text-muted-foreground hover:underline">View all</Link>}>
          <ProjectProgressList projects={projects.slice(0, 6)} empty="No projects yet." />
        </Section>
        <Section title="Team progress (tasks you can see)" className="lg:col-span-2">
          <WorkloadTable rows={workload(members, tasks, today).filter((r) => r.open + r.completed > 0)} empty="No assigned work in your view yet." />
        </Section>
      </div>
    </div>
  );
}

function IndividualDashboard({ session, tasks, projects, today }: Props) {
  const me = session.user.id;
  const mine = tasks.filter((t) => t.assignees.some((a) => a.userId === me));
  const open = mine.filter(isOpen);
  const dueToday = open.filter((t) => t.dueDate === today);
  const overdue = mine.filter((t) => isOverdue(t.dueDate, t.status, today));
  const inProgress = mine.filter((t) => t.status === "IN_PROGRESS");
  const completed = mine.filter((t) => t.status === "COMPLETED");
  const weekEnd = addDays(today, 7);
  const upcoming = open.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= weekEnd).sort(byDue);
  const countable = mine.filter((t) => t.status !== "CANCELLED");
  const pct = countable.length ? Math.round((completed.length / countable.length) * 100) : 0;
  const myProjectIds = new Set(mine.map((t) => t.projectId));
  const myProjects = projects.filter((p) => myProjectIds.has(p.id));

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Due today" value={dueToday.length} icon={CalendarClock} tone="info" />
        <StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone={overdue.length ? "danger" : "default"} />
        <StatCard label="In progress" value={inProgress.length} icon={CircleDot} href="/tasks?status=IN_PROGRESS" />
        <StatCard label="Completed" value={completed.length} icon={CheckCircle2} tone="success" href="/tasks?status=COMPLETED" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="My tasks" className="lg:col-span-2" action={<Link href="/tasks" className="text-xs text-muted-foreground hover:underline">View all</Link>}>
          <CompactTaskList tasks={open.sort(byDue).slice(0, 10)} today={today} empty="You have no open tasks. Nice work!" />
        </Section>
        <Section title="Personal progress">
          <div className="grid gap-2">
            <div className="flex items-end justify-between">
              <span className="text-3xl font-semibold tabular-nums">{pct}%</span>
              <span className="text-xs text-muted-foreground">
                {completed.length} of {countable.length} tasks completed
              </span>
            </div>
            <ProgressBar value={pct} />
          </div>
          <Link href="/reports" className={buttonVariants({ variant: "outline", className: "mt-4 h-9 w-full" })}>
            Submit today&apos;s report
          </Link>
        </Section>
        <Section title="Due today & overdue">
          <CompactTaskList tasks={[...overdue, ...dueToday].sort(byDue).slice(0, 8)} today={today} empty="Nothing due today." />
        </Section>
        <Section title="Upcoming (7 days)">
          <CompactTaskList tasks={upcoming.slice(0, 8)} today={today} empty="No upcoming deadlines." />
        </Section>
        <Section title="My projects">
          <ProjectProgressList projects={myProjects.slice(0, 6)} empty="You're not on any project tasks yet." />
        </Section>
      </div>
    </div>
  );
}
