import { Briefcase, FolderOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { TargetWorkspacePicker } from "@/components/app/target-workspace-picker";
import { ClientFormButton } from "@/components/clients/client-form-button";
import { ClientTable, type ClientRow } from "@/components/clients/client-table";
import { listClients } from "@/lib/data/clients";
import { listProjects } from "@/lib/data/projects";
import { getMyWorkspaces, getWorkspaceMembers } from "@/lib/data/workspace";
import { mayCreateClients } from "@/lib/auth/roles";
import { combineProgress } from "@/lib/progress";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const [clients, projects, members, allWorkspaces] = await Promise.all([
    listClients(workspace.id, { withContacts: session.profile.role !== "INDIVIDUAL" }),
    listProjects(workspace.id),
    getWorkspaceMembers(workspace.id),
    isSuperAdmin ? getMyWorkspaces() : Promise.resolve([]),
  ]);
  const canEdit = session.profile.role !== "INDIVIDUAL";
  // Individuals add clients only with the can_create_clients_projects grant (028).
  const canAdd = mayCreateClients(session.profile.role, members.find((m) => m.userId === session.user.id) ?? null);
  // Contact details are shown to admins only.
  const showContacts = canEdit;
  const unassigned = projects.filter((p) => !p.clientId);

  const rows: ClientRow[] = clients.map((c) => {
    const list = projects.filter((p) => p.clientId === c.id);
    const progress = combineProgress(list.map((p) => ({ total: p.totalTasks, completed: p.completedTasks })));
    return {
      id: c.id,
      name: c.name,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      notes: c.notes,
      isActive: c.isActive,
      projects: list.length,
      totalTasks: progress.total,
      completedTasks: progress.completed,
      progress: progress.progress,
    };
  });

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${clients.length} client${clients.length === 1 ? "" : "s"} in ${workspace.name} · Client → Project → Task`}
        actions={
          canAdd ? (
            <div className="flex flex-wrap items-center gap-2">
              {isSuperAdmin ? <TargetWorkspacePicker workspaces={allWorkspaces} activeId={workspace.id} /> : null}
              <ClientFormButton workspaceId={workspace.id} />
            </div>
          ) : null
        }
      />
      {clients.length === 0 && projects.length === 0 ? (
        <EmptyState icon={Briefcase} title="No clients yet" description={canAdd ? "Add a client, then create projects for it." : "Clients will appear here."} />
      ) : (
        <div className="grid gap-6">
          {clients.length ? (
            <ClientTable
              rows={rows}
              workspaceId={workspace.id}
              canEdit={canEdit}
              showContacts={showContacts}
              showReports={session.permissions.viewTeamReports}
            />
          ) : null}

          {unassigned.length ? (
            <Section title={`Unassigned projects (${unassigned.length})`} icon={FolderOpen} description="Internal work and projects without a client">
              <ul className="-my-2 divide-y divide-border/70">
                {unassigned.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="grid gap-1.5 py-2.5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="truncate font-medium hover:underline">{p.name}</span>
                        <ProjectStatusBadge status={p.status} />
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ProgressBar value={p.progress} className="w-28 sm:w-36" />
                        <span className="shrink-0 tabular-nums">
                          {p.completedTasks}/{p.totalTasks}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      )}
    </>
  );
}
