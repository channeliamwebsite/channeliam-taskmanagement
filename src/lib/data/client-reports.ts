import "server-only";

import { isSnapshot, type ClientReportDocument, type ReportFormat } from "@/lib/client-reports/snapshot";
import { createClient } from "@/lib/supabase/server";

import { loadError } from "./errors";

export type ClientReportSettings = {
  frequencyDays: 15 | 30;
  format: ReportFormat;
  firstPeriodStart: string;
  isActive: boolean;
  recipientEmail: string | null;
  recipientAuthorized: boolean;
  autoDelivery: boolean;
};

export type ClientReportRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "PENDING" | "READY" | "FAILED";
  error: string | null;
  attempts: number;
  generatedAt: string | null;
  reviewedAt: string | null;
  updatesNote: string | null;
  prioritiesNote: string | null;
};

export type ClientReportOverview = {
  clientId: string;
  clientName: string;
  settings: ClientReportSettings | null;
  reports: ClientReportRow[];
};

/** Reports kept on screen per client (the full history stays in the database). */
const HISTORY_PER_CLIENT = 24;

/**
 * Report settings and recent history for the workspace's clients. RLS returns
 * settings and reports only to super admins and the workspace's admins.
 */
export async function getClientReportOverview(workspaceId: string): Promise<ClientReportOverview[]> {
  const supabase = await createClient();
  const { data: clients, error } = await supabase.from("clients").select("id, name").eq("workspace_id", workspaceId).order("name");
  if (error) throw loadError("Failed to load clients", error);
  if (!clients.length) return [];
  const ids = clients.map((c) => c.id);
  const [settingsRes, reportsRes] = await Promise.all([
    supabase.from("client_report_settings").select("*").in("client_id", ids),
    supabase
      .from("client_reports")
      .select("id, client_id, period_start, period_end, status, error, attempts, generated_at, reviewed_at, updates_note, priorities_note")
      .in("client_id", ids)
      .order("period_end", { ascending: false })
      .limit(ids.length * HISTORY_PER_CLIENT),
  ]);
  if (settingsRes.error) throw loadError("Failed to load report settings", settingsRes.error);
  if (reportsRes.error) throw loadError("Failed to load client reports", reportsRes.error);

  return clients.map((c) => {
    const s = settingsRes.data.find((r) => r.client_id === c.id);
    return {
      clientId: c.id,
      clientName: c.name,
      settings: s
        ? {
            frequencyDays: s.frequency_days === 30 ? 30 : 15,
            format: (s.report_format as ReportFormat) ?? "BOTH",
            firstPeriodStart: s.first_period_start,
            isActive: s.is_active,
            recipientEmail: s.recipient_email,
            recipientAuthorized: Boolean(s.recipient_authorized_at),
            autoDelivery: s.auto_delivery,
          }
        : null,
      reports: reportsRes.data
        .filter((r) => r.client_id === c.id)
        .slice(0, HISTORY_PER_CLIENT)
        .map((r) => ({
          id: r.id,
          periodStart: r.period_start,
          periodEnd: r.period_end,
          status: r.status as ClientReportRow["status"],
          error: r.error,
          attempts: r.attempts,
          generatedAt: r.generated_at,
          reviewedAt: r.reviewed_at,
          updatesNote: r.updates_note,
          prioritiesNote: r.priorities_note,
        })),
    };
  });
}

/** One generated report for export, or null when it is not visible (RLS) or not ready. */
export async function getClientReportDocument(reportId: string): Promise<{ doc: ClientReportDocument; format: ReportFormat } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_reports")
    .select("client_id, status, snapshot, generated_at, updates_note, priorities_note")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw loadError("Failed to load the client report", error);
  if (!data || data.status !== "READY" || !isSnapshot(data.snapshot)) return null;
  const { data: settings } = await supabase.from("client_report_settings").select("report_format").eq("client_id", data.client_id).maybeSingle();
  return {
    doc: { snapshot: data.snapshot, generatedAt: data.generated_at, updatesNote: data.updates_note, prioritiesNote: data.priorities_note },
    format: (settings?.report_format as ReportFormat) ?? "BOTH",
  };
}
