import { CheckSquare } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskList } from "@/components/tasks/task-list";
import { listProjectOptions } from "@/lib/data/projects";
import { listTasks, toTaskRows } from "@/lib/data/tasks";
import { getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { displayName, isPriority, isTaskStatus } from "@/lib/domain";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Tasks" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const scope = get("scope") ?? "mine";
  const project = get("project");
  const client = get("client");
  const assignee = get("assignee");
  const status = get("status");
  const priority = get("priority");
  const view = get("view") === "board" ? "board" : "list";
  const userId = session.user.id;
  const today = workspaceToday(workspace);

  const [projects, members] = await Promise.all([
    listProjectOptions(workspace.id),
    getWorkspaceMembers(workspace.id),
  ]);
  const clientProjectIds =
    client === "none"
      ? projects.filter((p) => !p.clientId).map((p) => p.id)
      : client && UUID.test(client)
        ? projects.filter((p) => p.clientId === client).map((p) => p.id)
        : undefined;

  const tasks = await listTasks({
    workspaceId: workspace.id,
    projectId: project && UUID.test(project) ? project : undefined,
    projectIds: clientProjectIds,
    assigneeId: assignee && UUID.test(assignee) ? assignee : scope === "mine" ? userId : undefined,
    createdBy: scope === "created" ? userId : undefined,
    status: isTaskStatus(status) ? status : undefined,
    priority: isPriority(priority) ? priority : undefined,
    search: get("q"),
  });

  const rows = toTaskRows(tasks, session, today);
  const canCreate = session.permissions.createTasks;
  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
  }));
  const clients = [
    ...new Map(projects.filter((p) => p.clientId && p.clientName).map((p) => [p.clientId!, p.clientName!])).entries(),
  ]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const title = view === "board" ? "Task Board" : scope === "mine" ? "My Tasks" : "Tasks";

  return (
    <>
      <PageHeader
        title={title}
        description={`${rows.length} task${rows.length === 1 ? "" : "s"} in ${workspace.name}`}
        actions={canCreate ? <NewTaskButton projects={projects} members={memberOptions} /> : null}
      />
      <TaskFilters projects={projects} members={memberOptions} clients={clients} />
      {rows.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={scope === "mine" ? "No tasks assigned to you" : "No tasks found"}
          description={
            canCreate
              ? projects.length
                ? "Create a task or adjust the filters."
                : "Create a project first, then add tasks to it."
              : "Tasks assigned to you will appear here."
          }
        />
      ) : view === "board" ? (
        <TaskBoard tasks={rows} today={today} />
      ) : (
        <TaskList tasks={rows} today={today} />
      )}
    </>
  );
}
