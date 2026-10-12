import { CalendarDays, FolderKanban } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PriorityBadge, ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { ProjectFormButton } from "@/components/projects/project-form-dialog";
import { listClients } from "@/lib/data/clients";
import { listProjects } from "@/lib/data/projects";
import { canCreateProjects, getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { displayName, formatDate } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const [projects, members, canCreate, clients] = await Promise.all([
    listProjects(workspace.id),
    getWorkspaceMembers(workspace.id),
    canCreateProjects(workspace.id, session.user.id, session.profile.role),
    listClients(workspace.id),
  ]);
  const owners = members
    .filter((m) => m.isActive)
    .map((m) => ({ userId: m.userId, name: displayName({ full_name: m.fullName, email: m.email }) }));
  const today = workspaceToday(workspace);

  return (
    <>
      <PageHeader
        title="Projects"
        description={`${projects.length} project${projects.length === 1 ? "" : "s"} you can access`}
        actions={canCreate ? <ProjectFormButton mode="create" workspaceId={workspace.id} owners={owners} clients={clients} /> : null}
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description={canCreate ? "Create a project to start organising tasks." : "Projects you're involved in will appear here."}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const late = p.dueDate && p.dueDate < today && p.status !== "COMPLETED" && p.status !== "ARCHIVED";
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate font-medium">{p.name}</h2>
                      <p className="truncate text-xs text-muted-foreground">{p.clientName || "Internal"}</p>
                    </div>
                    <ProjectStatusBadge status={p.status} />
                  </div>
                  {p.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{p.description}</p> : null}
                  <div className="mt-auto grid gap-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {p.completedTasks}/{p.totalTasks} tasks done
                      </span>
                      <span className="tabular-nums">{p.progress}%</span>
                    </div>
                    <ProgressBar value={p.progress} />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <PriorityBadge priority={p.priority} />
                    <span className={cn("flex items-center gap-1", late ? "font-medium text-red-600" : "text-muted-foreground")}>
                      <CalendarDays className="size-3.5" aria-hidden="true" />
                      {p.dueDate ? formatDate(p.dueDate) : "No due date"}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
