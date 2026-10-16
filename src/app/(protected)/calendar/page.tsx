import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { CalendarView, type CalendarItem } from "@/components/calendar/calendar-view";
import { CalendarFilters } from "@/components/calendar/calendar-filters";
import { listProjectOptions } from "@/lib/data/projects";
import { listTasks } from "@/lib/data/tasks";
import { getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { addDaysISO, displayName, formatDate, isOverdue, isPriority, isTaskStatus, weekdayOf } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Calendar" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shiftMonth(date: string, delta: number) {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** Monday on or before the date. */
function weekStart(date: string) {
  return addDaysISO(date, -((weekdayOf(date) + 6) % 7));
}

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = workspaceToday(workspace);
  const view = get("view") === "week" ? "week" : get("view") === "day" ? "day" : "month";
  const anchor = DATE_RE.test(get("date") ?? "") ? get("date")! : today;
  const isAdmin = session.profile.role !== "INDIVIDUAL";
  const scope = isAdmin && get("scope") === "all" ? "all" : "mine";
  const client = get("client");
  const project = get("project");
  const priority = get("priority");
  const status = get("status");
  const employee = isAdmin && UUID.test(get("employee") ?? "") ? get("employee")! : undefined;
  const dept = isAdmin ? get("dept") : undefined;

  let days: string[];
  let prev: string;
  let next: string;
  let label: string;
  if (view === "month") {
    const first = `${anchor.slice(0, 7)}-01`;
    const start = weekStart(first);
    days = Array.from({ length: 42 }, (_, i) => addDaysISO(start, i));
    prev = shiftMonth(first, -1);
    next = shiftMonth(first, 1);
    label = new Date(`${first}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  } else if (view === "week") {
    const start = weekStart(anchor);
    days = Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
    prev = addDaysISO(start, -7);
    next = addDaysISO(start, 7);
    label = `${formatDate(days[0])} – ${formatDate(days[6])}`;
  } else {
    days = [anchor];
    prev = addDaysISO(anchor, -1);
    next = addDaysISO(anchor, 1);
    label = new Date(`${anchor}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  const [projects, members] = await Promise.all([listProjectOptions(workspace.id), getWorkspaceMembers(workspace.id)]);
  const clientProjectIds =
    client === "none"
      ? projects.filter((p) => !p.clientId).map((p) => p.id)
      : client && UUID.test(client)
        ? projects.filter((p) => p.clientId === client).map((p) => p.id)
        : undefined;

  const departmentIds = dept
    ? members
        .filter((m) => (dept === "none" ? !m.team?.trim() : m.team?.trim().toLowerCase() === dept.toLowerCase()))
        .map((m) => m.userId)
    : undefined;

  const tasks = await listTasks({
    workspaceId: workspace.id,
    // Picking an employee or department looks across the team, not just the viewer's own tasks.
    assigneeId: employee ?? (scope === "mine" && !dept ? session.user.id : undefined),
    assigneeIds: departmentIds,
    status: isTaskStatus(status) ? status : undefined,
    projectId: project && UUID.test(project) ? project : undefined,
    projectIds: clientProjectIds,
    priority: isPriority(priority) ? priority : undefined,
    dateRange: { from: days[0]!, to: days.at(-1)! },
  });

  const items: CalendarItem[] = [];
  for (const t of tasks) {
    const base = {
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      overdue: isOverdue(t.dueDate, t.status, today),
      where: [t.clientName, t.projectName].filter(Boolean).join(" · "),
      assignees: t.assignees.map((a) => a.fullName || a.email).join(", "),
      progress: t.status === "COMPLETED" ? 100 : t.progress,
    };
    if (t.scheduledDate) items.push({ ...base, kind: "scheduled", date: t.scheduledDate });
    if (t.dueDate && t.dueDate !== t.scheduledDate) items.push({ ...base, kind: "due", date: t.dueDate });
  }

  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
    team: m.team,
  }));
  const clients = [
    ...new Map(projects.filter((p) => p.clientId && p.clientName).map((p) => [p.clientId!, p.clientName!])).entries(),
  ].map(([id, name]) => ({ id, name }));

  const base = new URLSearchParams();
  for (const k of ["scope", "client", "project", "priority", "status", "employee", "dept"]) {
    const v = get(k);
    if (v) base.set(k, v);
  }
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams(base);
    p.set("view", view);
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    return `/calendar?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Calendar" description="Scheduled and due dates for the same tasks shown in My Day, lists and boards." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={href({ date: prev })} className="inline-flex size-8 items-center justify-center rounded-lg border hover:bg-muted" aria-label="Previous">
          <ChevronLeft className="size-4" />
        </Link>
        <Link href={href({ date: next })} className="inline-flex size-8 items-center justify-center rounded-lg border hover:bg-muted" aria-label="Next">
          <ChevronRight className="size-4" />
        </Link>
        <Link href={href({ date: today })} className="rounded-lg border px-2.5 py-1 text-xs hover:bg-muted">
          Today
        </Link>
        <h2 className="text-base font-semibold">{label}</h2>
        <div className="ml-auto inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs font-medium" role="tablist" aria-label="Calendar view">
          {(["month", "week", "day"] as const).map((v) => {
            const p = new URLSearchParams(base);
            p.set("view", v);
            p.set("date", anchor);
            return (
              <Link
                key={v}
                href={`/calendar?${p.toString()}`}
                role="tab"
                aria-selected={view === v}
                className={cn("rounded-md px-2.5 py-1 capitalize", view === v ? "bg-background shadow-xs" : "text-muted-foreground")}
              >
                {v}
              </Link>
            );
          })}
        </div>
      </div>
      <CalendarFilters
        isAdmin={isAdmin}
        clients={clients}
        projects={projects}
        employees={memberOptions.filter((m) => m.isActive).sort((a, b) => a.name.localeCompare(b.name))}
      />
      <CalendarView
        view={view}
        days={days}
        month={anchor.slice(0, 7)}
        today={today}
        items={items}
        canCreate
        workspaceId={workspace.id}
        selfOnly={session.permissions.assignTasks ? null : { userId: session.user.id }}
        projects={projects}
        members={memberOptions}
      />
    </>
  );
}
