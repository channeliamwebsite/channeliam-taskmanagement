"use client";

import { CalendarDays, KanbanSquare, List, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function TaskFilters({
  projects,
  members,
  clients = [],
  showScope = true,
  showProject = true,
  showDepartment = true,
}: {
  projects: { id: string; name: string; clientId?: string | null }[];
  members: { userId: string; name: string; team?: string | null }[];
  clients?: { id: string; name: string }[];
  showScope?: boolean;
  showProject?: boolean;
  showDepartment?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const view = params.get("view") === "board" ? "board" : "list";
  const scope = params.get("scope") ?? "mine";
  const q = params.get("q");
  const FILTER_KEYS = ["project", "client", "assignee", "status", "priority", "dept", "startFrom", "startTo", "dueFrom", "dueTo", "sort", "q"];
  const hasFilters = FILTER_KEYS.some((k) => params.get(k));
  const departments = [...new Set(members.map((m) => m.team?.trim()).filter((t): t is string => Boolean(t)))].sort((a, b) => a.localeCompare(b));
  const clientFilter = params.get("client");
  const projectChoices = projects.filter((p) => !clientFilter || (clientFilter === "none" ? !p.clientId : p.clientId === clientFilter));

  return (
    <div className={cn("mb-4 flex flex-col gap-3", pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        {showScope ? (
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Task scope">
            {[
              ["mine", "Assigned to me"],
              ["created", "Created by me"],
              ["all", "All visible"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={scope === value}
                onClick={() => update("scope", value === "mine" ? null : value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  scope === value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ml-auto inline-flex rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={view === "list"}
            onClick={() => update("view", null)}
            className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", view === "list" ? "bg-background shadow-xs" : "text-muted-foreground")}
          >
            <List className="size-3.5" aria-hidden="true" /> List
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "board"}
            onClick={() => update("view", "board")}
            className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium", view === "board" ? "bg-background shadow-xs" : "text-muted-foreground")}
          >
            <KanbanSquare className="size-3.5" aria-hidden="true" /> Board
          </button>
          {showScope ? (
            <Link
              href={`/calendar${scope === "all" ? "?scope=all" : ""}`}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <CalendarDays className="size-3.5" aria-hidden="true" /> Calendar
            </Link>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {showProject && clients.length ? (
          <NativeSelect
            aria-label="Filter by client"
            value={clientFilter ?? ""}
            onChange={(e) => {
              const next = new URLSearchParams(params.toString());
              if (e.target.value) next.set("client", e.target.value);
              else next.delete("client");
              next.delete("project");
              startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
            }}
            className="sm:w-44"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">Internal / no client</option>
          </NativeSelect>
        ) : null}
        {showProject ? (
          <NativeSelect
            aria-label="Filter by project"
            value={params.get("project") ?? ""}
            onChange={(e) => update("project", e.target.value || null)}
            className="sm:w-48"
          >
            <option value="">All projects</option>
            {projectChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <NativeSelect
          aria-label="Filter by assignee"
          value={params.get("assignee") ?? ""}
          onChange={(e) => update("assignee", e.target.value || null)}
          className="sm:w-48"
        >
          <option value="">Any assignee</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
        {showDepartment && departments.length ? (
          <NativeSelect
            aria-label="Filter by department"
            value={params.get("dept") ?? ""}
            onChange={(e) => update("dept", e.target.value || null)}
            className="sm:w-48"
          >
            <option value="">Any department</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="none">No department</option>
          </NativeSelect>
        ) : null}
        <NativeSelect
          aria-label="Filter by status"
          value={params.get("status") ?? ""}
          onChange={(e) => update("status", e.target.value || null)}
          className="sm:w-40"
        >
          <option value="">Any status</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TASK_STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Filter by priority"
          value={params.get("priority") ?? ""}
          onChange={(e) => update("priority", e.target.value || null)}
          className="sm:w-36"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Sort by"
          value={params.get("sort") ?? ""}
          onChange={(e) => update("sort", e.target.value || null)}
          className="sm:w-40"
        >
          <option value="">Recently updated</option>
          <option value="due">Due date</option>
          <option value="start">Start date</option>
          <option value="priority">Priority</option>
        </NativeSelect>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:items-center">
        {(
          [
            ["startFrom", "Start from"],
            ["startTo", "Start to"],
            ["dueFrom", "Due from"],
            ["dueTo", "Due to"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 sm:flex-row sm:items-center">
            {label}
            <input
              type="date"
              value={params.get(key) ?? ""}
              onChange={(e) => update(key, e.target.value || null)}
              className="h-8 rounded-lg border bg-transparent px-2 text-sm text-foreground"
            />
          </label>
        ))}
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams();
              if (params.get("view")) next.set("view", params.get("view")!);
              if (params.get("scope")) next.set("scope", params.get("scope")!);
              startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
            }}
          >
            <X aria-hidden="true" /> Clear filters
          </Button>
        ) : null}
        {q ? <span className="text-xs text-muted-foreground">Searching for “{q}”</span> : null}
      </div>
    </div>
  );
}
