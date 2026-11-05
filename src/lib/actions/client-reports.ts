"use server";

import { refresh } from "next/cache";

import { dbError, fail, getActor, isUuid, ok, parseDate, type ActionResult } from "./shared";

// Client reports (migration 038). The database functions check that the
// caller is a super admin or an admin of the client's workspace; these
// actions only validate input and refuse other roles early.

async function manager() {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN" && actor.profile.role !== "ADMIN") return fail("Only admins can manage client reports.");
  return actor;
}

export type ReportSettingsInput = {
  frequencyDays: number;
  format: string;
  firstPeriodStart: string;
  isActive: boolean;
  recipientEmail: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveClientReportSettings(clientId: string, input: ReportSettingsInput): Promise<ActionResult> {
  const actor = await manager();
  if (!actor.ok) return actor;
  if (!isUuid(clientId)) return fail("Invalid client.");
  if (input.frequencyDays !== 15 && input.frequencyDays !== 30) return fail("Choose every 15 or every 30 days.");
  if (!["PDF", "EXCEL", "BOTH"].includes(input.format)) return fail("Choose a report format.");
  const start = parseDate(input.firstPeriodStart);
  if (!start) return fail("Choose the first reporting period's start date.");
  const email = input.recipientEmail.trim();
  if (email && (email.length > 254 || !EMAIL.test(email))) return fail("Enter a valid recipient email or leave it empty.");

  const { error } = await actor.supabase.rpc("save_client_report_settings", {
    p_client_id: clientId,
    p_frequency_days: input.frequencyDays,
    p_report_format: input.format,
    p_first_period_start: start,
    p_is_active: input.isActive,
    p_recipient_email: email || undefined,
  });
  if (error) return fail(dbError(error, "Could not save the report settings."));
  refresh();
  return ok();
}

/**
 * Records that the current recipient is explicitly authorised to receive this
 * client's reports. Automatic delivery stays off: it is enabled only once SMTP
 * is configured and tested.
 */
export async function authorizeReportRecipient(clientId: string, authorize: boolean): Promise<ActionResult> {
  const actor = await manager();
  if (!actor.ok) return actor;
  if (!isUuid(clientId)) return fail("Invalid client.");
  const { error } = await actor.supabase.rpc("set_client_report_delivery", {
    p_client_id: clientId,
    p_authorize_recipient: authorize,
    p_auto_delivery: false,
  });
  if (error) return fail(dbError(error, "Could not update the recipient."));
  refresh();
  return ok();
}

export async function generateClientReportsNow(clientId: string): Promise<ActionResult<{ generated: number }>> {
  const actor = await manager();
  if (!actor.ok) return actor;
  if (!isUuid(clientId)) return fail("Invalid client.");
  const { data, error } = await actor.supabase.rpc("generate_client_reports_now", { p_client_id: clientId });
  if (error) return fail(dbError(error, "Could not generate the reports."));
  refresh();
  return ok({ generated: data ?? 0 });
}

export async function retryClientReport(reportId: string): Promise<ActionResult<{ status: string }>> {
  const actor = await manager();
  if (!actor.ok) return actor;
  if (!isUuid(reportId)) return fail("Invalid report.");
  const { data, error } = await actor.supabase.rpc("retry_client_report", { p_report_id: reportId });
  if (error) return fail(dbError(error, "Could not retry the report."));
  refresh();
  return ok({ status: data ?? "FAILED" });
}

export async function reviewClientReport(
  reportId: string,
  input: { updatesNote: string; prioritiesNote: string; markReviewed: boolean },
): Promise<ActionResult> {
  const actor = await manager();
  if (!actor.ok) return actor;
  if (!isUuid(reportId)) return fail("Invalid report.");
  if (input.updatesNote.length > 4000 || input.prioritiesNote.length > 4000) return fail("Notes must be at most 4000 characters.");
  const { error } = await actor.supabase.rpc("review_client_report", {
    p_report_id: reportId,
    p_updates_note: input.updatesNote,
    p_priorities_note: input.prioritiesNote,
    p_mark_reviewed: input.markReviewed,
  });
  if (error) return fail(dbError(error, "Could not save the review."));
  refresh();
  return ok();
}
