import "server-only";

import { appOrigin } from "@/lib/auth/origin";
import { sendEmail } from "@/lib/email/resend-sender";
import { leaveApprovedEmail, leaveRejectedEmail, leaveRequestedEmail } from "@/lib/email/templates/leave";
import { isLeaveType } from "@/lib/hr/leave";

import { getActor } from "./shared";

type Actor = Extract<Awaited<ReturnType<typeof getActor>>, { ok: true }>;

const DEFAULT_TO = "team@channeliam.com";
const DEFAULT_CC = "ceo@channeliam.com";

/** Writes the delivery outcome; a logging failure (e.g. a duplicate) is swallowed — it never affects the leave workflow. */
async function logResult(actor: Actor, applicationId: string, emailType: "REQUESTED" | "APPROVED" | "REJECTED", result: { ok: true } | { ok: false; error: string }) {
  const { error } = await actor.supabase.from("hr_leave_email_log").insert({
    application_id: applicationId,
    email_type: emailType,
    status: result.ok ? "SENT" : "FAILED",
    error: result.ok ? null : result.error.slice(0, 1000),
  });
  if (error) console.error("[leave-email] could not log delivery", { applicationId, emailType, error });
  if (!result.ok) console.error("[leave-email] send failed", { applicationId, emailType, error: result.error });
}

/**
 * Notifies team@/ceo@ (server-configured) of a new leave request. Called
 * after hr_apply_leave succeeds; any failure here is caught by the caller and
 * never fails the submission.
 */
export async function notifyLeaveRequested(actor: Actor, applicationId: string): Promise<void> {
  const [{ data: app }, { data: profile }, { data: hr }] = await Promise.all([
    actor.supabase.from("hr_leave_applications").select("leave_type, start_date, end_date, working_days, reason, created_at").eq("id", applicationId).single(),
    actor.supabase.from("profiles").select("full_name, email, team").eq("id", actor.userId).maybeSingle(),
    actor.supabase.from("hr_employee_profiles").select("employee_code").eq("user_id", actor.userId).maybeSingle(),
  ]);
  if (!app || !isLeaveType(app.leave_type)) return;

  const origin = await appOrigin();
  const { subject, html } = leaveRequestedEmail({
    employeeName: profile?.full_name || profile?.email || "An employee",
    employeeCode: hr?.employee_code || "—",
    department: profile?.team ?? null,
    leaveType: app.leave_type,
    start: app.start_date,
    end: app.end_date,
    workingDays: app.working_days,
    reason: app.reason,
    submittedAt: app.created_at,
    reviewUrl: `${origin}/hr/leave`,
  });

  const result = await sendEmail({ to: process.env.LEAVE_NOTIFY_TO?.trim() || DEFAULT_TO, cc: process.env.LEAVE_NOTIFY_CC?.trim() || DEFAULT_CC, subject, html });
  await logResult(actor, applicationId, "REQUESTED", result);
}

/**
 * Notifies the applicant that their leave request was approved or rejected.
 * Called after hr_decide_leave succeeds; any failure here is caught by the
 * caller and never fails the decision.
 */
export async function notifyLeaveDecided(actor: Actor, applicationId: string, approve: boolean): Promise<void> {
  const { data: app } = await actor.supabase
    .from("hr_leave_applications")
    .select("leave_type, start_date, end_date, working_days, decided_at, rejection_reason, applicant:profiles!hr_leave_applications_user_id_fkey(full_name, email)")
    .eq("id", applicationId)
    .single();
  if (!app || !isLeaveType(app.leave_type) || !app.applicant?.email) return;

  const employeeName = app.applicant.full_name || app.applicant.email;
  const decidedAt = app.decided_at ?? new Date().toISOString();
  const { subject, html } = approve
    ? leaveApprovedEmail({
        employeeName,
        leaveType: app.leave_type,
        start: app.start_date,
        end: app.end_date,
        workingDays: app.working_days,
        approvedBy: actor.profile.fullName || "Channeliam TaskManager",
        approvedAt: decidedAt,
      })
    : leaveRejectedEmail({
        employeeName,
        leaveType: app.leave_type,
        start: app.start_date,
        end: app.end_date,
        workingDays: app.working_days,
        rejectionReason: app.rejection_reason || "No reason given.",
        decidedAt,
      });

  const result = await sendEmail({ to: app.applicant.email, subject, html });
  await logResult(actor, applicationId, approve ? "APPROVED" : "REJECTED", result);
}
