import { Briefcase } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { TargetWorkspacePicker } from "@/components/app/target-workspace-picker";
import { ClientFormButton } from "@/components/clients/client-form-button";
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

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${clients.length} client${clients.length === 1 ? "" : "s"} · Client → Project → Task`}
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
        <div className="grid gap-4 md:grid-cols-2">
          {[...clients.map((c) => ({ client: c, list: projects.filter((p) => p.clientId === c.id) })),
            ...(unassigned.length ? [{ client: null, list: unassigned }] : [])].map(({ client, list }) => (
            <section key={client?.id ?? "none"} className="rounded-xl border bg-card">
              <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{client ? <Link href={`/clients/${client.id}`} className="hover:underline">{client.name}</Link> : "Internal / no client"}</h2>
                  {client && showContacts && (client.contactName || client.contactEmail) ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {[client.contactName, client.contactEmail].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                  {list.length ? <ClientProgress projects={list} /> : null}
                </div>
                {client && canEdit ? (
                  <ClientFormButton
                    workspaceId={workspace.id}
                    clientId={client.id}
                    initial={{
                      name: client.name,
                      contactName: client.contactName ?? "",
                      contactEmail: client.contactEmail ?? "",
                      notes: client.notes ?? "",
                    }}
                  />
                ) : null}
              </header>
              {list.length ? (
                <ul className="divide-y">
                  {list.map((p) => (
                    <li key={p.id}>
                      <Link href={`/projects/${p.id}`} className="grid gap-1.5 px-4 py-2.5 hover:bg-muted/40">
                        <span className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate font-medium">{p.name}</span>
                          <ProjectStatusBadge status={p.status} />
                        </span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <ProgressBar value={p.progress} />
                          <span className="shrink-0 tabular-nums">{p.completedTasks}/{p.totalTasks}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">No projects you can access.</p>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Combined progress of a client's projects (leaf tasks across all of them). */
function ClientProgress({ projects }: { projects: { totalTasks: number; completedTasks: number }[] }) {
  const c = combineProgress(projects.map((p) => ({ total: p.totalTasks, completed: p.completedTasks })));
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
      <ProgressBar value={c.progress} className="w-28" />
      <span className="tabular-nums">
        {c.completed}/{c.total} tasks · {c.progress}%
      </span>
    </div>
  );
}
