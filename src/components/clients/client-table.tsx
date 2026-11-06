"use client";

import { Briefcase, ChevronRight, FileSpreadsheet, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ProgressBar } from "@/components/app/badges";
import { ClientFormButton } from "@/components/clients/client-form-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type ClientRow = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  isActive: boolean;
  projects: number;
  totalTasks: number;
  completedTasks: number;
  progress: number;
};

type StatusFilter = "all" | "active" | "inactive";

/** Searchable, filterable client list. Data comes from the page; nothing is fetched here. */
export function ClientTable({
  rows,
  workspaceId,
  canEdit,
  showContacts,
  showReports,
}: {
  rows: ClientRow[];
  workspaceId: string;
  canEdit: boolean;
  showContacts: boolean;
  showReports: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "active" && !r.isActive) return false;
      if (status === "inactive" && r.isActive) return false;
      if (!q) return true;
      return [r.name, r.contactName, r.contactEmail].some((v) => v?.toLowerCase().includes(q));
    });
  }, [rows, query, status]);

  return (
    <section className="rounded-xl border border-border/80 bg-card shadow-card">
      <div className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients…" aria-label="Search clients" className="pl-9" />
        </div>
        <div className="flex items-center gap-3">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Client status" className="w-40">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelect>
          <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {visible.length} of {rows.length}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
          <Briefcase className="size-4" aria-hidden="true" /> No clients match these filters.
        </p>
      ) : (
        <>
          {/* Desktop / tablet: table. */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-surface/70 text-left text-xs tracking-wide text-muted-foreground uppercase">
                <tr className="border-b border-border/70">
                  <th className="px-5 py-2.5 font-medium">Client</th>
                  {showContacts ? <th className="px-3 py-2.5 font-medium">Contact</th> : null}
                  <th className="px-3 py-2.5 text-right font-medium">Projects</th>
                  <th className="px-3 py-2.5 font-medium">Progress</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tasks done</th>
                  <th className="px-5 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {visible.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() => router.push(`/clients/${r.id}`)}
                  >
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-xs font-semibold text-brand-soft-foreground">
                          {initials(r.name)}
                        </span>
                        <span className="min-w-0">
                          <Link href={`/clients/${r.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                            {r.name}
                          </Link>
                          {!r.isActive ? <Badge variant="neutral" className="mt-0.5">Inactive</Badge> : null}
                        </span>
                      </span>
                    </td>
                    {showContacts ? (
                      <td className="px-3 py-3">
                        <span className="block truncate">{r.contactName ?? "—"}</span>
                        {r.contactEmail ? <span className="block truncate text-xs text-muted-foreground">{r.contactEmail}</span> : null}
                      </td>
                    ) : null}
                    <td className="px-3 py-3 text-right tabular-nums">{r.projects}</td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-2">
                        <ProgressBar value={r.progress} className="w-28 lg:w-36" />
                        <span className="w-9 text-right text-xs font-medium tabular-nums">{r.progress}%</span>
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {r.completedTasks} / {r.totalTasks}
                    </td>
                    <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                      <span className="flex items-center justify-end gap-1">
                        {showReports ? (
                          <Link
                            href={`/client-reports#client-${r.id}`}
                            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label={`Client reports for ${r.name}`}
                            title="Client reports"
                          >
                            <FileSpreadsheet className="size-4" aria-hidden="true" />
                          </Link>
                        ) : null}
                        {canEdit ? (
                          <ClientFormButton
                            workspaceId={workspaceId}
                            clientId={r.id}
                            initial={{ name: r.name, contactName: r.contactName ?? "", contactEmail: r.contactEmail ?? "", notes: r.notes ?? "" }}
                          />
                        ) : null}
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards. */}
          <ul className="divide-y divide-border/70 md:hidden">
            {visible.map((r) => (
              <li key={r.id} className="grid gap-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/clients/${r.id}`} className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    {showContacts && (r.contactName || r.contactEmail) ? (
                      <span className="block truncate text-xs text-muted-foreground">{[r.contactName, r.contactEmail].filter(Boolean).join(" · ")}</span>
                    ) : null}
                  </Link>
                  <span className="flex shrink-0 items-center gap-1">
                    {!r.isActive ? <Badge variant="neutral">Inactive</Badge> : null}
                    {canEdit ? (
                      <ClientFormButton
                        workspaceId={workspaceId}
                        clientId={r.id}
                        initial={{ name: r.name, contactName: r.contactName ?? "", contactEmail: r.contactEmail ?? "", notes: r.notes ?? "" }}
                      />
                    ) : null}
                  </span>
                </div>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ProgressBar value={r.progress} />
                  <span className="shrink-0 tabular-nums">
                    {r.progress}% · {r.completedTasks}/{r.totalTasks} tasks · {r.projects} project{r.projects === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}
