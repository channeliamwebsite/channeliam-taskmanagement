import { CalendarDays, FolderKanban } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PriorityBadge, ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { ProjectFormButton } from "@/components/projects/project-form-dialog";
import { listClients } from "@/lib/data/clients";
import { listProjects } from "@/lib/data/projects";
import { canCreateProjects, getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, addDaysISO, displayName, formatDate } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Projects" };

const selectClass = "h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground";

const DEADLINES = {
  "": "Any deadline",
  overdue: "Overdue",
  week: "Due in 7 days",
  month: "Due in 30 days",
  none: "No deadline",
} as const;

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const client = get("client");
  const status = get("status");
  const dept = get("dept");
  const deadline = get("deadline") in DEADLINES ? (get("deadline") as keyof typeof DEADLINES) : "";
  const sort = get("sort");

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

  // Department of a project = its owner's department (projects have no department of their own).
  const ownerTeam = new Map(members.map((m) => [m.userId, m.team?.trim() || null]));
  const departments = [...new Set([...ownerTeam.values()].filter((t): t is string => Boolean(t)))].sort((a, b) => a.localeCompare(b));
  const isOpen = (s: string) => s !== "COMPLETED" && s !== "ARCHIVED";
  const filtered = projects
    .filter((p) => {
      if (client && (client === "none" ? p.clientId : p.clientId !== client)) return false;
      if (status && p.status !== status) return false;
      if (dept) {
        const team = p.ownerId ? ownerTeam.get(p.ownerId) ?? null : null;
        if (dept === "__none__" ? team : team?.toLowerCase() !== dept.toLowerCase()) return false;
      }
      if (deadline === "none" && p.dueDate) return false;
      if (deadline === "overdue" && !(p.dueDate && p.dueDate < today && isOpen(p.status))) return false;
      if ((deadline === "week" || deadline === "month") && !(p.dueDate && p.dueDate >= today && p.dueDate <= addDaysISO(today, deadline === "week" ? 7 : 30))) return false;
      return true;
    })
    .sort((a, b) =>
      sort === "deadline"
        ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
        : sort === "name"
          ? a.name.localeCompare(b.name)
          : 0,
    );

  return (
    <>
      <PageHeader
        title="Projects"
        description={`${projects.length} project${projects.length === 1 ? "" : "s"} you can access`}
        actions={canCreate ? <ProjectFormButton mode="create" workspaceId={workspace.id} owners={owners} clients={clients} /> : null}
      />
      {projects.length ? (
        <form action="/projects" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Client
            <select name="client" defaultValue={client} className={selectClass}>
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">Internal / no client</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Status
            <select name="status" defaultValue={status} className={selectClass}>
              <option value="">Any status</option>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Department (owner)
            <select name="dept" defaultValue={dept} className={selectClass}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              <option value="__none__">No department</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Deadline
            <select name="deadline" defaultValue={deadline} className={selectClass}>
              {Object.entries(DEADLINES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Sort
            <select name="sort" defaultValue={sort} className={selectClass}>
              <option value="">Default</option>
              <option value="deadline">Deadline</option>
              <option value="name">Name</option>
            </select>
          </label>
          <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">
            Apply
          </button>
          <Link href="/projects" className="h-9 px-2 text-sm leading-9 text-muted-foreground hover:underline">
            Clear
          </Link>
          <span className="ml-auto self-center text-xs text-muted-foreground">
            Showing {filtered.length} of {projects.length}
          </span>
        </form>
      ) : null}
      {filtered.length === 0 && projects.length ? (
        <EmptyState icon={FolderKanban} title="No projects match these filters" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description={canCreate ? "Create a project to start organising tasks." : "Projects you're involved in will appear here."}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
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
