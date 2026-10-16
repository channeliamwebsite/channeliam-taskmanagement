import { AlertTriangle, CalendarClock, CheckCircle2, History, ListTodo, Sun } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { StatCard } from "@/components/dashboard/widgets";
import { MeetingLinksCard } from "@/components/app/meeting-links-card";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskList } from "@/components/tasks/task-list";
import { listMeetingLinks, meetingsForPerson } from "@/lib/data/meetings";
import { listProjectOptions } from "@/lib/data/projects";
import { isCarriedForward, listTasks, toTaskRows, type TaskSummary } from "@/lib/data/tasks";
import { getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { PRIORITY_RANK, addDaysISO, displayName, formatDate, isOverdue } from "@/lib/domain";
import { isCompletedOn } from "@/lib/scheduling";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "My Day" };

const isOpen = (t: TaskSummary) => t.status !== "COMPLETED" && t.status !== "CANCELLED";

function byPriorityThenDue(a: TaskSummary, b: TaskSummary) {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    a.title.localeCompare(b.title)
  );
}

export default async function MyDayPage() {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const today = workspaceToday(workspace);
  const tomorrow = addDaysISO(today, 1);
  const canAssign = session.permissions.assignTasks;
  const [tasks, meetings, projects, members] = await Promise.all([
    listTasks({ workspaceId: workspace.id, assigneeId: session.user.id }),
    listMeetingLinks(workspace.id, { activeOnly: true }),
    canAssign ? listProjectOptions(workspace.id) : Promise.resolve([]),
    canAssign ? getWorkspaceMembers(workspace.id) : Promise.resolve([]),
  ]);
  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
    team: m.team,
  }));
  const open = tasks.filter(isOpen);
  const placed = new Set<string>();
  const take = (list: TaskSummary[]) => {
    list.forEach((t) => placed.add(t.id));
    return list.sort(byPriorityThenDue);
  };

  // Derived carry-forward: unfinished work scheduled before today. Nothing is
  // rewritten, so the original scheduled date, due date and priority stay intact.
  const carried = take(open.filter((t) => isCarriedForward(t, today)));
  const todays = take(
    open.filter((t) => !placed.has(t.id) && (t.scheduledDate === today || (!t.scheduledDate && t.dueDate === today))),
  );
  const inProgress = take(open.filter((t) => !placed.has(t.id) && t.status === "IN_PROGRESS"));
  const tomorrows = take(open.filter((t) => !placed.has(t.id) && t.scheduledDate === tomorrow));
  const unscheduled = take(open.filter((t) => !placed.has(t.id) && !t.scheduledDate));
  const completedToday = tasks
    .filter((t) => t.status === "COMPLETED" && isCompletedOn(t.completedAt, today, workspace.timezone))
    .sort(byPriorityThenDue);

  const overdue = open.filter((t) => isOverdue(t.dueDate, t.status, today)).length;
  const remaining = carried.length + todays.length;
  const rows = (list: TaskSummary[]) => toTaskRows(list, session, today);

  return (
    <>
      <PageHeader
        title="My Day"
        description={`${new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })} · ${workspace.timezone}`}
        actions={
          <NewTaskButton
            projects={projects}
            members={memberOptions}
            workspaceId={workspace.id}
            selfOnly={canAssign ? null : { userId: session.user.id }}
            label={canAssign ? "Add task" : "Add my task"}
          />
        }
      />

      <div className="mb-6">
        <MeetingLinksCard
          links={meetingsForPerson(meetings, session.profile.team, today)}
          canManage={session.profile.role === "SUPER_ADMIN"}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Planned for today" value={remaining + completedToday.length} icon={Sun} tone="info" />
        <StatCard label="Completed today" value={completedToday.length} icon={CheckCircle2} tone="success" />
        <StatCard label="Remaining" value={remaining} icon={ListTodo} />
        <StatCard label="Overdue" value={overdue} icon={AlertTriangle} tone={overdue ? "danger" : "default"} />
      </div>

      <div className="grid gap-5">
        {carried.length ? (
          <Section title={`Carried forward (${carried.length})`}>
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">
              Unfinished work from earlier days. Original due dates are unchanged — reschedule with the date field if needed.
            </p>
            <TaskList tasks={rows(carried)} today={today} />
          </Section>
        ) : null}

        <Section title={`Today's tasks (${todays.length})`}>
          {todays.length ? (
            <TaskList tasks={rows(todays)} today={today} />
          ) : (
            <EmptyState
              icon={Sun}
              title="Nothing scheduled for today"
              description="Schedule work for today from the lists below or from My Tasks."
              className="py-6"
            />
          )}
        </Section>

        {inProgress.length ? (
          <Section title={`In progress (${inProgress.length})`}>
            <TaskList tasks={rows(inProgress)} today={today} />
          </Section>
        ) : null}

        <Section title={`Tomorrow's priorities · ${formatDate(tomorrow)}`}>
          {tomorrows.length ? (
            <TaskList tasks={rows(tomorrows)} today={today} />
          ) : (
            <EmptyState icon={CalendarClock} title="Nothing scheduled for tomorrow yet" className="py-6" />
          )}
        </Section>

        {unscheduled.length ? (
          <Section title={`Not yet scheduled (${unscheduled.length})`}>
            <p className="-mt-1 mb-3 text-xs text-muted-foreground">Pick a day in the Scheduled column to plan these.</p>
            <TaskList tasks={rows(unscheduled)} today={today} />
          </Section>
        ) : null}

        <Section title={`Completed today (${completedToday.length})`}>
          {completedToday.length ? (
            <TaskList tasks={rows(completedToday)} today={today} />
          ) : (
            <EmptyState icon={History} title="Nothing completed yet today" className="py-6" />
          )}
        </Section>
      </div>
    </>
  );
}
