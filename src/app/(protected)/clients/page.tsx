import { Briefcase } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { ClientFormButton } from "@/components/clients/client-form-button";
import { listClients } from "@/lib/data/clients";
import { listProjects } from "@/lib/data/projects";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const [clients, projects] = await Promise.all([listClients(workspace.id, { withContacts: session.profile.role !== "INDIVIDUAL" }), listProjects(workspace.id)]);
  const canEdit = session.profile.role !== "INDIVIDUAL";
  // Contact details are shown to admins only.
  const showContacts = canEdit;
  const unassigned = projects.filter((p) => !p.clientId);

  return (
    <>
      <PageHeader
        title="Clients"
        description={`${clients.length} client${clients.length === 1 ? "" : "s"} · Client → Project → Task`}
        actions={canEdit ? <ClientFormButton workspaceId={workspace.id} /> : null}
      />
      {clients.length === 0 && projects.length === 0 ? (
        <EmptyState icon={Briefcase} title="No clients yet" description={canEdit ? "Add a client, then create projects for it." : "Clients will appear here."} />
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
