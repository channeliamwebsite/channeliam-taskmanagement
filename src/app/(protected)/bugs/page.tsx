import { Bug } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { BugStatusSelect } from "@/components/bugs/bug-status-select";
import { BUG_STATUSES, BUG_STATUS_LABELS, displayName, formatDateTime, type BugStatus } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";
import { loadError } from "@/lib/data/errors";

export const metadata: Metadata = { title: "Bug reports" };

const selectClass = "h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground";

const STATUS_STYLES: Record<BugStatus, string> = {
  OPEN: "bg-amber-50 text-amber-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  RESOLVED: "bg-emerald-50 text-emerald-700",
  CLOSED: "bg-zinc-100 text-zinc-600",
};

export default async function BugsPage({ searchParams }: PageProps<"/bugs">) {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const isReviewer = session.profile.role !== "INDIVIDUAL";
  const status = BUG_STATUSES.find((s) => s === get("status"));
  const mineOnly = !isReviewer || get("mine") === "1";

  // RLS: reporters read their own reports; admins and super admins read the workspace's.
  const supabase = await createClient();
  let query = supabase
    .from("bug_reports")
    .select("id, title, description, page, steps, status, created_at, reported_by, reporter:profiles!bug_reports_reported_by_fkey(full_name, email)")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status);
  if (mineOnly) query = query.eq("reported_by", session.user.id);
  const { data, error } = await query;
  if (error) throw loadError("Failed to load bug reports", error);

  return (
    <>
      <PageHeader
        title="Bug reports"
        description={isReviewer ? "Reports from everyone in the workspace. Update the status as you triage." : "Bugs you have reported and their status."}
      />
      <form action="/bugs" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Status
          <select name="status" defaultValue={status ?? ""} className={selectClass}>
            <option value="">Any status</option>
            {BUG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BUG_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {isReviewer ? (
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="mine" value="1" defaultChecked={get("mine") === "1"} className="size-4 accent-primary" />
            Only mine
          </label>
        ) : null}
        <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">
          Apply
        </button>
        <Link href="/bugs" className="h-9 px-2 text-sm leading-9 text-muted-foreground hover:underline">
          Clear
        </Link>
      </form>

      {data.length === 0 ? (
        <EmptyState icon={Bug} title="No bug reports" description="Use “Report a bug” at the bottom of the sidebar to send one." />
      ) : (
        <ul className="grid gap-3">
          {data.map((b) => {
            const s = (BUG_STATUSES.find((x) => x === b.status) ?? "OPEN") as BugStatus;
            const reporter = b.reporter ? displayName({ full_name: b.reporter.full_name, email: b.reporter.email }) : "Unknown";
            return (
              <li key={b.id} className="grid gap-2 rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-medium">{b.title}</h2>
                    <p className="text-xs text-muted-foreground">
                      {reporter} · {formatDateTime(b.created_at)} IST{b.page ? ` · ${b.page}` : ""}
                    </p>
                  </div>
                  {isReviewer ? (
                    <BugStatusSelect id={b.id} status={s} />
                  ) : (
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", STATUS_STYLES[s])}>{BUG_STATUS_LABELS[s]}</span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">{b.description}</p>
                {b.steps ? (
                  <div className="text-sm">
                    <p className="text-xs font-medium text-muted-foreground">Steps to reproduce</p>
                    <p className="whitespace-pre-wrap">{b.steps}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
