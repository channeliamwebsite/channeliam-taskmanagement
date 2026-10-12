"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { PRIORITIES, PRIORITY_LABELS } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function CalendarFilters({
  isAdmin,
  clients,
  projects,
}: {
  isAdmin: boolean;
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string | null }[];
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
    </div>
  );
}
