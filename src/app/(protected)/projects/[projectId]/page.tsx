import { CheckSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityFeed } from "@/components/app/activity-feed";
import { PriorityBadge, ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { DeleteProjectButton, ProjectFormButton } from "@/components/projects/project-form-dialog";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskList } from "@/components/tasks/task-list";
import { listActivity } from "@/lib/data/activity";
import { listClients } from "@/lib/data/clients";
import { getProject } from "@/lib/data/projects";
import { listTasks, toTaskRows } from "@/lib/data/tasks";
import { getWorkspaceMembers } from "@/lib/data/workspace";
import { displayName, formatDate, isTaskStatus, todayISO } from "@/lib/domain";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Project" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const [tasks, members, activity, clients] = await Promise.all([
    listTasks({
      workspaceId: project.workspaceId,
      projectId: project.id,
      assigneeId: assignee && UUID.test(assignee) ? assignee : undefined,
      status: isTaskStatus(status) ? status : undefined,
      search: get("q"),
    }),
    getWorkspaceMembers(project.workspaceId),
    listActivity({ workspaceId: project.workspaceId, projectId: project.id, limit: 15 }),
    listClients(project.workspaceId),
  ]);

  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
  }));
  const names = new Map(memberOptions.map((m) => [m.userId, m.name]));
  const role = session.profile.role;
  const userId = session.user.id;
  const canEdit =
    role === "SUPER_ADMIN" || (role === "ADMIN" && (project.ownerId === userId || project.createdBy === userId));
  const today = todayISO();
  const rows = toTaskRows(tasks, session);

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.clientName ? `Client: ${project.clientName}` : undefined}
        actions={
          <>
            {session.permissions.createTasks ? (
              <NewTaskButton projects={[{ id: project.id, name: project.name }]} members={memberOptions} defaultProjectId={project.id} />
            ) : null}
            {canEdit ? (
              <ProjectFormButton
                mode="edit"
                workspaceId={project.workspaceId}
                projectId={project.id}
                owners={memberOptions.filter((m) => m.isActive)}
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
            {role === "SUPER_ADMIN" ? (
              <DeleteProjectButton projectId={project.id} name={project.name} taskCount={project.totalTasks} />
            ) : null}
          </>
        }
      >
        <Link href="/projects" className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">
          ← All projects
        </Link>
      </PageHeader>

      <div className="mb-6 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <ProjectStatusBadge status={project.status} className="mt-1" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Priority</p>
          <PriorityBadge priority={project.priority} className="mt-1" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Owner</p>
          <p className="mt-1 truncate text-sm font-medium">{project.ownerName ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Timeline</p>
          <p className="mt-1 text-sm">
            {formatDate(project.startDate)} → {formatDate(project.dueDate)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            Progress · {project.completedTasks}/{project.totalTasks} tasks
          </p>
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar value={project.progress} />
            <span className="text-xs tabular-nums">{project.progress}%</span>
          </div>
        </div>
        {project.description ? (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground sm:col-span-2 lg:col-span-5">{project.description}</p>
        ) : null}
      </div>

      <TaskFilters projects={[]} members={memberOptions} showScope={false} showProject={false} />
      {rows.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="No tasks here yet"
          description={session.permissions.createTasks ? "Add the first task for this project." : "Tasks you can access will appear here."}
        />
      ) : view === "board" ? (
        <TaskBoard tasks={rows} today={today} />
      ) : (
        <TaskList tasks={rows} showProject={false} today={today} />
      )}

      <Section title="Recent project activity" className="mt-6">
        <ActivityFeed items={activity} names={names} />
      </Section>
    </>
  );
}
