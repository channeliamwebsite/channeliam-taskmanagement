import { AlertTriangle, Briefcase, CalendarDays, CheckCircle2, FileSpreadsheet, FolderKanban, History, ListTodo } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityFeed } from "@/components/app/activity-feed";
import { ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { ClientFormButton } from "@/components/clients/client-form-button";
import { DeleteClientButton } from "@/components/clients/delete-client-button";
import { ProjectDeliverables } from "@/components/projects/project-deliverables";
import { ProjectFormButton } from "@/components/projects/project-form-dialog";
import { CompactTaskList, StatCard } from "@/components/dashboard/widgets";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listActivity, type ActivityItem } from "@/lib/data/activity";
import { getClient } from "@/lib/data/clients";
import { listProjects } from "@/lib/data/projects";
import { listTasks } from "@/lib/data/tasks";
import { canCreateProjects, getWorkspaceMembers, getMyWorkspaces } from "@/lib/data/workspace";
import { addDaysISO, displayName, formatDate, isOverdue, todayISO } from "@/lib/domain";
import { combineProgress, isLeafTask } from "@/lib/progress";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Client" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPage({ params }: PageProps<"/clients/[clientId]">) {
  const { clientId } = await params;
  if (!UUID.test(clientId)) notFound();
  const { session } = await getPageContext();

  const client = await getClient(clientId, { withContacts: session.profile.role !== "INDIVIDUAL" });
  if (!client) notFound(); // missing or outside the caller's workspaces (RLS)

  const workspaces = await getMyWorkspaces();
  const tz = workspaces.find((w) => w.id === client.workspaceId)?.timezone;
  const today = todayISO(new Date(), tz);

  const projects = (await listProjects(client.workspaceId)).filter((p) => p.clientId === client.id);
  const projectIds = projects.map((p) => p.id);
  const [tasks, members, canCreate, activityLists] = await Promise.all([
    listTasks({ workspaceId: client.workspaceId, projectIds }),
    getWorkspaceMembers(client.workspaceId),
    // Same rule as the Projects page; createProject and RLS enforce it again.
    canCreateProjects(client.workspaceId, session.user.id, session.profile.role),
    Promise.all(projects.slice(0, 10).map((p) => listActivity({ workspaceId: client.workspaceId, projectId: p.id, limit: 10 }))),
  ]);
  const activity = activityLists
    .flat()
    .sort((a: ActivityItem, b: ActivityItem) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 15);

  const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  // Client totals use the same leaf-task rule as project progress (a parent is
  // counted through its subtasks), combined across the client's projects.
  const overall = combineProgress(projects.map((p) => ({ total: p.totalTasks, completed: p.completedTasks })));
  const openWork = open.filter(isLeafTask);
  const overdue = openWork.filter((t) => isOverdue(t.dueDate, t.status, today));
  const horizon = addDaysISO(today, 14);
  const upcoming = open
    .filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= horizon)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const names = new Map(members.map((m) => [m.userId, displayName({ full_name: m.fullName, email: m.email })]));
  const isAdmin = session.profile.role !== "INDIVIDUAL";
  const owners = members
    .filter((m) => m.isActive)
    .map((m) => ({ userId: m.userId, name: displayName({ full_name: m.fullName, email: m.email }) }));
  // Task creation inside each project (same dialog and createTask action as everywhere else).
  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
    team: m.team,
  }));
  const selfOnly = session.permissions.assignTasks ? null : { userId: session.user.id };
  // Open deliverables per project: main tasks still open, with their subtask counts.
  const openByProject = new Map<string, typeof open>();
  for (const t of open) {
    if (t.parentTaskId) continue;
    openByProject.set(t.projectId, [...(openByProject.get(t.projectId) ?? []), t]);
  }


  const showReports = session.permissions.viewTeamReports;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {client.name}
            <Badge variant={client.isActive ? "success" : "neutral"}>{client.isActive ? "Active" : "Inactive"}</Badge>
          </span>
        }
        description={
          isAdmin && (client.contactName || client.contactEmail)
            ? [client.contactName, client.contactEmail].filter(Boolean).join(" · ")
            : `${projects.length} project${projects.length === 1 ? "" : "s"}`
        }
        actions={
          <>
            {showReports ? (
              <Link href={`/client-reports#client-${client.id}`} className={buttonVariants({ variant: "outline" })}>
                <FileSpreadsheet aria-hidden="true" /> Client reports
              </Link>
            ) : null}
            {isAdmin ? (
              <>
                <ClientFormButton
                  workspaceId={client.workspaceId}
                  clientId={client.id}
                  initial={{
                    name: client.name,
                    contactName: client.contactName ?? "",
                    contactEmail: client.contactEmail ?? "",
                    notes: client.notes ?? "",
                  }}
                />
                <DeleteClientButton clientId={client.id} name={client.name} />
              </>
            ) : null}
          </>
        }
      >
        <Link href="/clients" className="mb-2 inline-block text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
          ← All clients
        </Link>
      </PageHeader>

      {/* Overall progress + summary. */}
      <div className="mb-6 grid gap-3 lg:grid-cols-[minmax(0,18rem)_1fr]">
        <div className="flex flex-col justify-center gap-2 rounded-xl border border-border/80 bg-gradient-to-br from-brand-soft/60 to-card p-4 shadow-card">
          <span className="text-sm font-medium text-muted-foreground">Overall progress</span>
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{overall.progress}%</span>
          <ProgressBar value={overall.progress} />
          <span className="text-xs text-muted-foreground">A parent task is counted through its subtasks</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Projects" value={projects.length} icon={FolderKanban} tone="brand" />
          <StatCard label="Total tasks" value={overall.total} icon={ListTodo} tone="info" hint={`${openWork.length} open`} />
          <StatCard label="Completed" value={overall.completed} icon={CheckCircle2} tone="success" />
          <StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone={overdue.length ? "danger" : "default"} />
        </div>
      </div>

      <Tabs defaultValue="projects">
        <TabsList className="mb-4">
          <TabsTrigger value="projects">Projects ({projects.length})</TabsTrigger>
          <TabsTrigger value="deadlines">Deadlines{overdue.length ? ` · ${overdue.length} overdue` : ""}</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <Section
            title={`Projects (${projects.length})`}
            icon={FolderKanban}
            description="Expand a project to see its open deliverables and add tasks"
            action={
              canCreate ? (
                <ProjectFormButton
                  mode="create"
                  workspaceId={client.workspaceId}
                  owners={owners}
                  clients={[]}
                  fixedClient={{ id: client.id, name: client.name }}
                />
              ) : null
            }
          >
            {projects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects for this client"
                description={
                  canCreate
                    ? "Use Add project to create the first one."
                    : session.profile.role === "ADMIN"
                      ? "Projects for this client will appear here. To add projects, ask a super admin to allow project creation for you."
                      : "Projects for this client will appear here."
                }
                className="py-6"
              />
            ) : (
              <ul className="-my-2 divide-y">
                {projects.map((p) => {
                  const deliverables = openByProject.get(p.id) ?? [];
                  const projectOption = [{ id: p.id, name: p.name, clientId: client.id, clientName: client.name }];
                  return (
                    <li key={p.id}>
                      {/* Expands in place: progress, open deliverables, and task / subtask creation. */}
                      <details className="group">
                        <summary className="grid cursor-pointer list-none gap-1.5 py-2.5 hover:bg-muted/30">
                          <span className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate font-medium">
                              <span className="mr-1 inline-block text-muted-foreground transition-transform group-open:rotate-90">›</span>
                              {p.name}
                            </span>
                            <ProjectStatusBadge status={p.status} />
                          </span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <ProgressBar value={p.progress} />
                            <span className="shrink-0 tabular-nums">
                              {p.completedTasks}/{p.totalTasks} · {p.dueDate ? `due ${formatDate(p.dueDate)}` : "no due date"}
                            </span>
                          </span>
                        </summary>
                        <div className="grid gap-3 pb-3 pl-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <NewTaskButton
                              projects={projectOption}
                              members={memberOptions}
                              workspaceId={client.workspaceId}
                              defaultProjectId={p.id}
                              selfOnly={selfOnly}
                              label="Add task"
                              size="sm"
                            />
                            <Link href={`/projects/${p.id}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                              Open full project page →
                            </Link>
                          </div>
                          <p className="text-xs font-medium text-muted-foreground">
                            Open deliverables ({deliverables.length}) · {p.progress}% complete
                          </p>
                          <ProjectDeliverables
                            project={{ id: p.id, name: p.name, clientId: client.id, clientName: client.name }}
                            workspaceId={client.workspaceId}
                            tasks={deliverables}
                            members={memberOptions}
                            selfOnly={selfOnly}
                            canAddSubtask={(t) => isAdmin || t.createdBy === session.user.id}
                          />
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="deadlines">
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Upcoming deadlines (14 days)" icon={CalendarDays}>
              <CompactTaskList tasks={upcoming.slice(0, 10)} today={today} empty="No deadlines in the next two weeks." showAssignee />
            </Section>
            <Section title={`Overdue (${overdue.length})`} icon={AlertTriangle}>
              <CompactTaskList tasks={overdue.slice(0, 10)} today={today} empty="Nothing overdue." showAssignee />
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <Section title="Recent activity" icon={History}>
            <ActivityFeed items={activity} names={names} />
          </Section>
        </TabsContent>

        <TabsContent value="details">
          <Section title="Client information" icon={Briefcase} className="max-w-2xl">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {isAdmin ? (
                <>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Contact</dt>
                    <dd className="mt-0.5">{client.contactName || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Email</dt>
                    <dd className="mt-0.5 break-all">{client.contactEmail || "—"}</dd>
                  </div>
                </>
              ) : null}
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted-foreground">Description</dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{client.notes || "—"}</dd>
              </div>
            </dl>
          </Section>
        </TabsContent>
      </Tabs>
    </>
  );
}
