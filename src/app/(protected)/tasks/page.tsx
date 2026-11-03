import { CheckSquare } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { TargetWorkspacePicker } from "@/components/app/target-workspace-picker";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskList } from "@/components/tasks/task-list";
import { listClientOptions } from "@/lib/data/clients";
import { listMyCollaborationProjectIds } from "@/lib/data/collaborators";
import { listProjectOptions } from "@/lib/data/projects";
import { listTasks, toTaskRows, type TaskSummary } from "@/lib/data/tasks";
import { createClient } from "@/lib/supabase/server";
import { getMyWorkspaces, getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { displayName, isPriority, isTaskStatus } from "@/lib/domain";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Tasks" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SORTS = ["updated", "due", "start", "priority"] as const;

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
  const department = get("dept");
  const date = (k: string) => {
    const v = get(k);
    return v && ISO_DATE.test(v) ? v : undefined;
  };
  const sort = SORTS.find((s) => s === get("sort"));
  const view = get("view") === "board" ? "board" : "list";
  const userId = session.user.id;
  const today = workspaceToday(workspace);

  const [projects, members, clientOptions] = await Promise.all([
    listProjectOptions(workspace.id),
    getWorkspaceMembers(workspace.id),
    // Every client for the New task dialog (assigners only).
    session.permissions.assignTasks ? listClientOptions(workspace.id) : Promise.resolve([]),
  ]);
  const clientProjectIds =
    client === "none"
      ? projects.filter((p) => !p.clientId).map((p) => p.id)
      : client && UUID.test(client)
        ? projects.filter((p) => p.clientId === client).map((p) => p.id)
        : undefined;

  // Department = the assignee's team (profiles.team); "none" = people with no department.
  const departmentIds = department
    ? members
        .filter((m) => (department === "none" ? !m.team?.trim() : m.team?.trim().toLowerCase() === department.toLowerCase()))
        .map((m) => m.userId)
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
    assigneeIds: departmentIds,
    startFrom: date("startFrom"),
    startTo: date("startTo"),
    dueFrom: date("dueFrom"),
    dueTo: date("dueTo"),
    sort,
  });

  const rows = toTaskRows(tasks, session, today);
  const canAssign = session.permissions.assignTasks;
  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
    team: m.team,
  }));
  const clients = [
    ...new Map(projects.filter((p) => p.clientId && p.clientName).map((p) => [p.clientId!, p.clientName!])).entries(),
  ]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const title = view === "board" ? "Task Board" : scope === "mine" ? "My Tasks" : "Tasks";
  const allWorkspaces = session.profile.role === "SUPER_ADMIN" ? await getMyWorkspaces() : [];
  const external = scope === "mine" && view !== "board" ? toTaskRows(await collaborationTasks(userId, workspace.id), session) : [];

  return (
    <>
      <PageHeader
        title={title}
        description={`${rows.length} task${rows.length === 1 ? "" : "s"} in ${workspace.name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {allWorkspaces.length ? <TargetWorkspacePicker workspaces={allWorkspaces} activeId={workspace.id} /> : null}
            <NewTaskButton
              projects={projects}
              clients={clientOptions}
              members={memberOptions}
              workspaceId={workspace.id}
              selfOnly={canAssign ? null : { userId }}
            />
          </div>
        }
      />
      <TaskFilters projects={projects} members={memberOptions} clients={clients} />
      {rows.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={scope === "mine" ? "No tasks assigned to you" : "No tasks found"}
          description={
            canAssign
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
      {external.length ? (
        <Section title={`From other workspaces (${external.length})`} className="mt-6">
          <p className="mb-2 text-xs text-muted-foreground">Tasks assigned to you in projects you were given access to.</p>
          <TaskList tasks={external} today={today} />
        </Section>
      ) : null}
    </>
  );
}

/**
 * Tasks assigned to the user in projects of other workspaces they were given
 * access to (030). RLS returns only those tasks; one query per workspace.
 */
async function collaborationTasks(userId: string, activeWorkspaceId: string): Promise<TaskSummary[]> {
  const projectIds = await listMyCollaborationProjectIds(userId);
  if (!projectIds.length) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("id, workspace_id").in("id", projectIds);
  const byWorkspace = new Map<string, string[]>();
  for (const p of data ?? []) {
    if (p.workspace_id === activeWorkspaceId) continue;
    byWorkspace.set(p.workspace_id, [...(byWorkspace.get(p.workspace_id) ?? []), p.id]);
  }
  const lists = await Promise.all(
    [...byWorkspace].map(([workspaceId, ids]) => listTasks({ workspaceId, projectIds: ids, assigneeId: userId })),
  );
  return lists.flat();
}
