import { AlertTriangle, CheckCircle2, CheckSquare, CircleDot, History, Layers, ListTodo, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityFeed } from "@/components/app/activity-feed";
import { PriorityBadge, ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { StatCard } from "@/components/dashboard/widgets";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeleteProjectButton, ProjectFormButton } from "@/components/projects/project-form-dialog";
import { ProjectDeliverables } from "@/components/projects/project-deliverables";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { ProjectAccess } from "@/components/projects/project-access";
import { listActiveEmployees, listProjectCollaborators } from "@/lib/data/collaborators";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskList } from "@/components/tasks/task-list";
import { listActivity } from "@/lib/data/activity";
import { listClients } from "@/lib/data/clients";
import { getProject } from "@/lib/data/projects";
import { listTasks, toTaskRows } from "@/lib/data/tasks";
import { mayEditProject } from "@/lib/auth/roles";
import { canCreateProjects, getMyWorkspaces, getWorkspaceMembers } from "@/lib/data/workspace";
import { statusCounts } from "@/lib/super-admin-overview";
import { displayName, formatDate, isPriority, isTaskStatus, todayISO, type Priority } from "@/lib/domain";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Project" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isoDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[projectId]">) {
  const { projectId } = await params;
  if (!UUID.test(projectId)) notFound();
  const { session } = await getPageContext();

  const project = await getProject(projectId);
  if (!project) notFound();

  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const assignee = get("assignee");
  const status = get("status");
  const view = get("view") === "board" ? "board" : "list";

  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const [tasks, members, activity, clients, mayCreate, collaborators, employees] = await Promise.all([
    listTasks({
      workspaceId: project.workspaceId,
      projectId: project.id,
      assigneeId: assignee && UUID.test(assignee) ? assignee : undefined,
      status: isTaskStatus(status) ? status : undefined,
      priority: isPriority(get("priority")) ? (get("priority") as Priority) : undefined,
      search: get("q"),
      startFrom: isoDate(get("startFrom")),
      startTo: isoDate(get("startTo")),
      dueFrom: isoDate(get("dueFrom")),
      dueTo: isoDate(get("dueTo")),
      sort: (["updated", "due", "start", "priority"] as const).find((s) => s === get("sort")),
    }),
    getWorkspaceMembers(project.workspaceId),
    listActivity({ workspaceId: project.workspaceId, projectId: project.id, limit: 15 }),
    listClients(project.workspaceId),
    canCreateProjects(project.workspaceId, session.user.id, session.profile.role),
    // People from other workspaces with access to this project (030; RLS-scoped).
    session.profile.role === "INDIVIDUAL" ? Promise.resolve([]) : listProjectCollaborators(project.id),
    isSuperAdmin ? listActiveEmployees() : Promise.resolve([]),
  ]);

  const memberOptions = [
    ...members.map((m) => ({
      userId: m.userId,
      name: displayName({ full_name: m.fullName, email: m.email }),
      role: m.role,
      isActive: m.isActive,
      team: m.team,
    })),
    // Collaborators can be assigned this project's tasks (030).
    ...collaborators.map((c) => ({ userId: c.userId, name: `${c.name} (project access)`, role: "INDIVIDUAL" as const, isActive: true, team: null })),
  ];
  const memberIds = new Set(members.map((m) => m.userId));
  const collaboratorIds = new Set(collaborators.map((c) => c.userId));
  const accessCandidates = employees.filter((e) => !memberIds.has(e.userId) && !collaboratorIds.has(e.userId));
  const names = new Map(memberOptions.map((m) => [m.userId, m.name]));
  const role = session.profile.role;
  const userId = session.user.id;
  // Same rule as the projects update policy (migration 020); RLS enforces it again.
  const canEdit = mayEditProject(role, userId, project, mayCreate);
  const today = todayISO();
  const rows = toTaskRows(tasks, session);
  // Summary figures always use the project's full task list (not the filtered view below).
  const filtersActive = ["assignee", "status", "priority", "q", "startFrom", "startTo", "dueFrom", "dueTo"].some((k) => get(k));
  const [allTasks, workspaces] = await Promise.all([
    filtersActive ? listTasks({ workspaceId: project.workspaceId, projectId: project.id }) : Promise.resolve(tasks),
    getMyWorkspaces(),
  ]);
  const counts = statusCounts(allTasks, today);
  const progress = counts.total ? Math.round((counts.completed / counts.total) * 100) : 0;
  const workspaceName = workspaces.find((w) => w.id === project.workspaceId)?.name ?? null;
  const showAccess = session.profile.role !== "INDIVIDUAL";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {project.name}
            <ProjectStatusBadge status={project.status} />
          </span>
        }
        description={[project.clientName ? `Client: ${project.clientName}` : "Internal project", workspaceName ? `Workspace: ${workspaceName}` : null]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <NewTaskButton
              projects={[{ id: project.id, name: project.name, clientId: project.clientId, clientName: project.clientName }]}
              members={memberOptions}
              workspaceId={project.workspaceId}
              defaultProjectId={project.id}
              selfOnly={session.permissions.assignTasks ? null : { userId: session.user.id }}
            />
            {canEdit ? (
              <ProjectFormButton
                mode="edit"
                workspaceId={project.workspaceId}
                projectId={project.id}
                owners={memberOptions.filter((m) => m.isActive && memberIds.has(m.userId))}
                clients={clients}
                initial={{
                  name: project.name,
                  description: project.description ?? "",
                  clientName: project.clientName ?? "",
                  clientId: project.clientId ?? "",
                  status: project.status,
                  priority: project.priority,
                  startDate: project.startDate ?? "",
                  dueDate: project.dueDate ?? "",
                  ownerId: project.ownerId ?? "",
                }}
              />
            ) : null}
            {role === "SUPER_ADMIN" && !project.isDefault ? (
              <DeleteProjectButton projectId={project.id} name={project.name} />
            ) : null}
          </>
        }
      >
        <Link href="/projects" className="mb-2 inline-block text-xs font-medium text-muted-foreground hover:text-foreground hover:underline">
          ← All projects
        </Link>
      </PageHeader>

      <div className="mb-6 grid gap-3 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="grid gap-3 rounded-xl border border-border/80 bg-gradient-to-br from-brand-soft/60 to-card p-4 shadow-card">
          <div className="flex items-end justify-between gap-2">
            <span>
              <span className="block text-sm font-medium text-muted-foreground">Progress</span>
              <span className="text-3xl font-semibold tracking-tight tabular-nums">{progress}%</span>
            </span>
            <PriorityBadge priority={project.priority} />
          </div>
          <ProgressBar value={progress} />
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Owner</dt>
              <dd className="truncate font-medium">{project.ownerName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Timeline</dt>
              <dd className="font-medium">
                {formatDate(project.startDate)} → {formatDate(project.dueDate)}
              </dd>
            </div>
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total tasks" value={counts.total} icon={ListTodo} tone="brand" />
          <StatCard label="Completed" value={counts.completed} icon={CheckCircle2} tone="success" />
          <StatCard label="Pending" value={counts.pending} icon={CircleDot} tone="warning" hint={`${counts.inProgress} in progress`} />
          <StatCard label="Overdue" value={counts.overdue} icon={AlertTriangle} tone={counts.overdue ? "danger" : "default"} />
        </div>
        {project.description ? (
          <p className="rounded-xl border border-border/80 bg-card p-4 text-sm whitespace-pre-wrap text-muted-foreground shadow-card lg:col-span-2">{project.description}</p>
        ) : null}
      </div>

      <Tabs defaultValue="tasks">
        <TabsList className="mb-4">
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
          {showAccess ? <TabsTrigger value="access">Access</TabsTrigger> : null}
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks">
          <TaskFilters projects={[]} members={memberOptions} showScope={false} showProject={false} showDepartment={false} />
          {rows.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title={filtersActive ? "No tasks match these filters" : "No tasks here yet"}
              description={session.permissions.assignTasks ? "Add the first task for this project." : "Tasks you can access will appear here."}
            />
          ) : view === "board" ? (
            <TaskBoard tasks={rows} today={today} />
          ) : (
            <TaskList tasks={rows} showProject={false} today={today} />
          )}
        </TabsContent>

        <TabsContent value="deliverables">
          <Section title="Open deliverables" icon={Layers} description="Main tasks still open, with their subtasks">
            <ProjectDeliverables
              project={{ id: project.id, name: project.name, clientId: project.clientId, clientName: project.clientName }}
              workspaceId={project.workspaceId}
              tasks={allTasks.filter((t) => !t.parentTaskId && t.status !== "COMPLETED" && t.status !== "CANCELLED")}
              members={memberOptions}
              selfOnly={session.permissions.assignTasks ? null : { userId: session.user.id }}
              canAddSubtask={(t) => session.profile.role !== "INDIVIDUAL" || t.createdBy === session.user.id}
              limit={15}
            />
          </Section>
        </TabsContent>

        {showAccess ? (
          <TabsContent value="access">
            <Section title="Access from other workspaces" icon={Users}>
              <ProjectAccess projectId={project.id} collaborators={collaborators} candidates={accessCandidates} canManage={isSuperAdmin} />
            </Section>
          </TabsContent>
        ) : null}

        <TabsContent value="activity">
          <Section title="Recent project activity" icon={History}>
            <ActivityFeed items={activity} names={names} />
          </Section>
        </TabsContent>
      </Tabs>
    </>
  );
}
