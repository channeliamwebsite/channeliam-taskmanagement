import { AlertTriangle, CheckCircle2, FolderKanban, ListTodo } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityFeed } from "@/components/app/activity-feed";
import { ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { ClientFormButton } from "@/components/clients/client-form-button";
import { CompactTaskList, StatCard } from "@/components/dashboard/widgets";
import { listActivity, type ActivityItem } from "@/lib/data/activity";
import { getClient } from "@/lib/data/clients";
import { listProjects } from "@/lib/data/projects";
import { listTasks } from "@/lib/data/tasks";
import { getWorkspaceMembers, getMyWorkspaces } from "@/lib/data/workspace";
import { addDaysISO, displayName, formatDate, isOverdue, todayISO } from "@/lib/domain";

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
  const [tasks, members, activityLists] = await Promise.all([
    listTasks({ workspaceId: client.workspaceId, projectIds }),
    getWorkspaceMembers(client.workspaceId),
    Promise.all(projects.slice(0, 10).map((p) => listActivity({ workspaceId: client.workspaceId, projectId: p.id, limit: 10 }))),
  ]);
  const activity = activityLists
    .flat()
    .sort((a: ActivityItem, b: ActivityItem) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 15);

  const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
  const countable = tasks.filter((t) => t.status !== "CANCELLED");
  const done = countable.filter((t) => t.status === "COMPLETED").length;
  const overdue = open.filter((t) => isOverdue(t.dueDate, t.status, today));
  const horizon = addDaysISO(today, 14);
  const upcoming = open
    .filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= horizon)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const names = new Map(members.map((m) => [m.userId, displayName({ full_name: m.fullName, email: m.email })]));
  const isAdmin = session.profile.role !== "INDIVIDUAL";

  return (
    <>
      <PageHeader
        title={client.name}
        description={client.isActive ? "Active client" : "Inactive client"}
        actions={
          isAdmin ? (
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
          ) : null
        }
      >
        <Link href="/clients" className="mb-1 inline-block text-xs text-muted-foreground hover:text-foreground hover:underline">
          ← All clients
        </Link>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Projects" value={projects.length} icon={FolderKanban} />
        <StatCard label="Open tasks" value={open.length} icon={ListTodo} tone="info" />
        <StatCard label="Completed" value={`${done}/${countable.length}`} icon={CheckCircle2} tone="success" />
        <StatCard label="Overdue" value={overdue.length} icon={AlertTriangle} tone={overdue.length ? "danger" : "default"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Section title="Projects">
            {projects.length === 0 ? (
              <EmptyState icon={FolderKanban} title="No projects for this client" description="Assign a client when creating or editing a project." className="py-6" />
            ) : (
              <ul className="-my-2 divide-y">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="grid gap-1.5 py-2.5 hover:bg-muted/30">
                      <span className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{p.name}</span>
                        <ProjectStatusBadge status={p.status} />
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ProgressBar value={p.progress} />
                        <span className="shrink-0 tabular-nums">
                          {p.completedTasks}/{p.totalTasks} · {p.dueDate ? `due ${formatDate(p.dueDate)}` : "no due date"}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Upcoming deadlines (14 days)">
            <CompactTaskList tasks={upcoming.slice(0, 10)} today={today} empty="No deadlines in the next two weeks." showAssignee />
          </Section>
          {overdue.length ? (
            <Section title="Overdue">
              <CompactTaskList tasks={overdue.slice(0, 10)} today={today} empty="" showAssignee />
            </Section>
          ) : null}
          <Section title="Recent activity">
            <ActivityFeed items={activity} names={names} />
          </Section>
        </div>
        <aside className="grid content-start gap-6">
          <Section title="Client information">
            <dl className="grid gap-3 text-sm">
              {isAdmin ? (
                <>
                  <div>
                    <dt className="text-muted-foreground">Contact</dt>
                    <dd>{client.contactName || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="break-all">{client.contactEmail || "—"}</dd>
                  </div>
                </>
              ) : null}
              <div>
                <dt className="text-muted-foreground">Description</dt>
                <dd className="whitespace-pre-wrap">{client.notes || "—"}</dd>
              </div>
            </dl>
          </Section>
        </aside>
      </div>
    </>
  );
}
