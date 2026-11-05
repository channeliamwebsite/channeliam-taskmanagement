import { FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { TargetWorkspacePicker } from "@/components/app/target-workspace-picker";
import { ClientReportCard } from "@/components/client-reports/client-report-card";
import { getClientReportOverview } from "@/lib/data/client-reports";
import { getMyWorkspaces, workspaceToday } from "@/lib/data/workspace";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Client Reports" };

// Automated client reports (migration 038): per-client schedule, history and
// exports. Super admins and admins only (ROUTE_ROLES and RLS).
export default async function ClientReportsPage() {
  const { session, workspace } = await getPageContext(["SUPER_ADMIN", "ADMIN"]);
  if (!workspace) return <NoWorkspace session={session} />;

  const [overview, allWorkspaces] = await Promise.all([
    getClientReportOverview(workspace.id),
    session.profile.role === "SUPER_ADMIN" ? getMyWorkspaces() : Promise.resolve([]),
  ]);
  const today = workspaceToday(workspace);

  return (
    <>
      <PageHeader
        title="Client Reports"
        description="Team-level progress reports every 15 or 30 days. Reports are generated automatically each morning after a period ends."
        actions={allWorkspaces.length ? <TargetWorkspacePicker workspaces={allWorkspaces} activeId={workspace.id} /> : null}
      />
      <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Reports contain team totals and task titles only — no employee names, attendance or HR information. Automatic email
        delivery is not available yet: download and review reports here.
      </p>
      {overview.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title="No clients yet" description="Add a client on the Clients page to set up reports." />
      ) : (
        <div className="grid gap-4">
          {overview.map((c) => (
            <Section key={c.clientId} title={c.clientName}>
              <ClientReportCard overview={c} today={today} />
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
