"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function CalendarFilters({
  isAdmin,
  clients,
  projects,
  employees = [],
}: {
  isAdmin: boolean;
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string | null }[];
  employees?: { userId: string; name: string; team?: string | null }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const client = params.get("client") ?? "";

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  const scope = params.get("scope") === "all" ? "all" : "mine";
  const dept = params.get("dept") ?? "";
  const departments = [...new Set(employees.map((e) => e.team?.trim()).filter((t): t is string => Boolean(t)))].sort((a, b) => a.localeCompare(b));
  const employeeChoices = employees.filter((e) => !dept || (dept === "none" ? !e.team?.trim() : e.team?.trim().toLowerCase() === dept.toLowerCase()));
  const projectChoices = projects.filter((p) => !client || (client === "none" ? !p.clientId : p.clientId === client));

  return (
    <div className={cn("mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center", pending && "opacity-70")}>
      {isAdmin ? (
        <div className="inline-flex w-fit rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Whose tasks">
          {[
            ["mine", "My tasks"],
            ["all", "Team tasks"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              onClick={() => update({ scope: value === "mine" ? null : value })}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                scope === value ? "bg-background shadow-xs" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {isAdmin ? (
        <>
          <NativeSelect aria-label="Department" value={dept} onChange={(e) => update({ dept: e.target.value || null, employee: null })} className="sm:w-48">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="none">No department</option>
          </NativeSelect>
          <NativeSelect aria-label="Employee" value={params.get("employee") ?? ""} onChange={(e) => update({ employee: e.target.value || null })} className="sm:w-44">
            <option value="">{scope === "mine" && !dept ? "Me" : "All employees"}</option>
            {employeeChoices.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </>
      ) : null}
      <NativeSelect aria-label="Client" value={client} onChange={(e) => update({ client: e.target.value || null, project: null })} className="sm:w-44">
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="none">Internal / no client</option>
      </NativeSelect>
      <NativeSelect aria-label="Project" value={params.get("project") ?? ""} onChange={(e) => update({ project: e.target.value || null })} className="sm:w-48">
        <option value="">All projects</option>
        {projectChoices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Priority" value={params.get("priority") ?? ""} onChange={(e) => update({ priority: e.target.value || null })} className="sm:w-36">
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Status" value={params.get("status") ?? ""} onChange={(e) => update({ status: e.target.value || null })} className="sm:w-40">
        <option value="">Any status</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {TASK_STATUS_LABELS[s]}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
