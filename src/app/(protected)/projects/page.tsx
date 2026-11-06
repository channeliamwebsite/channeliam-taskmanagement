import { CalendarDays, ChevronRight, FolderKanban, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PriorityBadge, ProgressBar, ProjectStatusBadge } from "@/components/app/badges";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TargetWorkspacePicker } from "@/components/app/target-workspace-picker";
import { ProjectFormButton } from "@/components/projects/project-form-dialog";
import { listClients } from "@/lib/data/clients";
import { listProjects } from "@/lib/data/projects";
import { canCreateProjects, getMyWorkspaces, getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, addDaysISO, displayName, formatDate } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Projects" };

const selectClass = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground shadow-xs sm:w-auto";

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
  const q = get("q").trim().toLowerCase();

  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const [projects, members, canCreate, clients, allWorkspaces] = await Promise.all([
    listProjects(workspace.id),
    getWorkspaceMembers(workspace.id),
    canCreateProjects(workspace.id, session.user.id, session.profile.role),
    listClients(workspace.id),
    // Every role: the workspace filter lists the caller's own workspaces.
    getMyWorkspaces(),
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
      if (q && ![p.name, p.clientName, p.description].some((v) => v?.toLowerCase().includes(q))) return false;
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
        actions={
          canCreate ? (
            <div className="flex flex-wrap items-center gap-2">
              {isSuperAdmin ? <TargetWorkspacePicker workspaces={allWorkspaces} activeId={workspace.id} /> : null}
              <ProjectFormButton mode="create" workspaceId={workspace.id} owners={owners} clients={clients} />
            </div>
          ) : null
        }
      />
      {projects.length ? (
        <form action="/projects" className="mb-4 grid gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-card sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative w-full lg:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input name="q" type="search" defaultValue={get("q")} placeholder="Search projects…" aria-label="Search projects" className="pl-9" />
            </div>
            {allWorkspaces.length > 1 ? (
              <div className="w-full sm:w-56">
                <WorkspaceSwitcher workspaces={allWorkspaces} activeId={workspace.id} />
              </div>
            ) : null}
            <span className="text-xs text-muted-foreground lg:ml-auto">
              Showing {filtered.length} of {projects.length}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <select name="client" defaultValue={client} className={selectClass} aria-label="Client">
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="none">Internal / no client</option>
            </select>
            <select name="status" defaultValue={status} className={selectClass} aria-label="Status">
              <option value="">Any status</option>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select name="dept" defaultValue={dept} className={selectClass} aria-label="Department (owner)">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              <option value="__none__">No department</option>
            </select>
            <select name="deadline" defaultValue={deadline} className={selectClass} aria-label="Deadline">
              {Object.entries(DEADLINES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select name="sort" defaultValue={sort} className={selectClass} aria-label="Sort">
              <option value="">Default order</option>
              <option value="deadline">Sort: deadline</option>
              <option value="name">Sort: name</option>
            </select>
            <span className="col-span-2 flex items-center gap-2 sm:ml-auto">
              <button type="submit" className={buttonVariants({ variant: "outline" })}>
                Apply
              </button>
              <Link href="/projects" className="px-2 text-sm font-medium text-primary hover:underline">
                Clear
              </Link>
            </span>
          </div>
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
        <section className="rounded-xl border border-border/80 bg-card shadow-card">
          {/* Tablet / desktop: table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface/70 text-left text-xs tracking-wide text-muted-foreground uppercase">
                <tr className="border-b border-border/70">
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-3 py-2.5 font-medium">Client</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Progress</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tasks done</th>
                  <th className="px-3 py-2.5 font-medium">Due</th>
                  <th className="px-3 py-2.5 font-medium">Owner</th>
                  <th className="px-5 py-2.5">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {filtered.map((p) => {
                  const late = p.dueDate && p.dueDate < today && p.status !== "COMPLETED" && p.status !== "ARCHIVED";
                  return (
                    <tr key={p.id} className="group relative transition-colors hover:bg-accent/50">
                      <td className="px-5 py-3">
                        <Link href={`/projects/${p.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                          {p.name}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <PriorityBadge priority={p.priority} />
                        </span>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{p.clientName || "Internal"}</td>
                      <td className="px-3 py-3">
                        <ProjectStatusBadge status={p.status} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2">
                          <ProgressBar value={p.progress} className="w-24 lg:w-32" />
                          <span className="w-9 text-right text-xs font-medium tabular-nums">{p.progress}%</span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {p.completedTasks} / {p.totalTasks}
                      </td>
                      <td className={cn("px-3 py-3 whitespace-nowrap", late ? "font-medium text-danger-foreground" : "text-muted-foreground")}>
                        {p.dueDate ? formatDate(p.dueDate) : "—"}
                      </td>
                      <td className="max-w-40 truncate px-3 py-3 text-muted-foreground">{p.ownerName ?? "—"}</td>
                      <td className="px-5 py-3 text-right">
                        <ChevronRight className="ml-auto size-4 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards. */}
          <ul className="divide-y divide-border/70 md:hidden">
            {filtered.map((p) => {
              const late = p.dueDate && p.dueDate < today && p.status !== "COMPLETED" && p.status !== "ARCHIVED";
              return (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="grid gap-2 px-4 py-3">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.clientName || "Internal"}
                          {p.ownerName ? ` · ${p.ownerName}` : ""}
                        </span>
                      </span>
                      <ProjectStatusBadge status={p.status} />
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ProgressBar value={p.progress} />
                      <span className="shrink-0 tabular-nums">
                        {p.progress}% · {p.completedTasks}/{p.totalTasks}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs">
                      <PriorityBadge priority={p.priority} />
                      <span className={cn("flex items-center gap-1", late ? "font-medium text-danger-foreground" : "text-muted-foreground")}>
                        <CalendarDays className="size-3.5" aria-hidden="true" />
                        {p.dueDate ? formatDate(p.dueDate) : "No due date"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
