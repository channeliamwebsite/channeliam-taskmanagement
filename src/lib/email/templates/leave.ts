// Leave notification email bodies. Pure string-building (no server-only
// imports) so these are unit-testable. Brand colours, logo and signature
// match the existing Supabase Auth templates (supabase/templates/*.html) —
// same look across every email this app sends.

import { formatDateRange, LEAVE_LABELS, type LeaveType } from "../../hr/leave.ts";

const RED = "#D92232";
const DARK_RED = "#B5172A";
const TINT = "#FDF2F3";
const LOGO_URL = "https://taskmanager.likesandshares.com/email/channeliam-logo.png";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function formatSubmittedAt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function detailRow(label: string, value: string) {
  return `<tr>
    <td style="padding:4px 12px 4px 0;font-size:13px;color:#6b7280;white-space:nowrap;">${escapeHtml(label)}</td>
    <td style="padding:4px 0;font-size:13px;color:#1f2328;font-weight:600;">${value}</td>
  </tr>`;
}

function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" bgcolor="${RED}" style="border-radius:8px;">
        <a href="${href}" target="_blank" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

function layout({ title, heading, intro, detailsHtml, noteHtml, ctaHtml }: { title: string; heading: string; intro: string; detailsHtml: string; noteHtml?: string; ctaHtml?: string }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2328;">
        <tr><td style="height:4px;background:${RED};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:28px 4px 8px;">
            <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:700;color:${DARK_RED};">${escapeHtml(heading)}</h1>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${intro}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 4px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              ${detailsHtml}
            </table>
          </td>
        </tr>
        ${ctaHtml ? `<tr><td style="padding:0 4px 20px;">${ctaHtml}</td></tr>` : ""}
        ${noteHtml ? `<tr><td style="padding:0 4px 24px;"><p style="margin:0;padding:12px 14px;background:${TINT};border-left:3px solid ${RED};font-size:13px;line-height:1.6;color:#5c2a30;">${noteHtml}</p></td></tr>` : ""}
        <tr><td style="border-top:1px solid #eeeeee;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:20px 4px 4px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="top" style="padding-right:14px;">
                  <img src="${LOGO_URL}" width="48" height="48" alt="Channeliam" style="display:block;border:0;width:48px;height:48px;">
                </td>
                <td valign="top" style="font-size:13px;line-height:1.6;color:#4b5563;">
                  Regards,<br>
                  <strong style="color:#1f2328;">Channeliam TaskManager Team</strong><br>
                  <a href="https://channeliam.com" style="color:${RED};text-decoration:none;">Channeliam.com</a> | Likes &amp; Shares Pvt Ltd
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export type LeaveRequestedEmailInput = {
  employeeName: string;
  employeeCode: string;
  department: string | null;
  leaveType: LeaveType;
  start: string;
  end: string;
  workingDays: number;
  reason: string;
  submittedAt: string;
  reviewUrl: string;
};

export function leaveRequestedEmail(input: LeaveRequestedEmailInput): { subject: string; html: string } {
  const subject = `New Leave Request – ${input.employeeName} – ${input.employeeCode}`;
  const details =
    detailRow("Employee", escapeHtml(input.employeeName)) +
    detailRow("Employee ID", escapeHtml(input.employeeCode)) +
    detailRow("Department", escapeHtml(input.department ?? "—")) +
    detailRow("Leave type", escapeHtml(LEAVE_LABELS[input.leaveType])) +
    detailRow("Dates", escapeHtml(formatDateRange(input.start, input.end))) +
    detailRow("Working days", String(input.workingDays)) +
    detailRow("Reason", escapeHtml(input.reason)) +
    detailRow("Submitted", escapeHtml(formatSubmittedAt(input.submittedAt)));
  const html = layout({
    title: subject,
    heading: "New Leave Request",
    intro: `<strong>${escapeHtml(input.employeeName)}</strong> (${escapeHtml(input.employeeCode)}) has submitted a leave request that needs your review.`,
    detailsHtml: details,
    ctaHtml: button("Review Leave Request", input.reviewUrl),
  });
  return { subject, html };
}

export type LeaveApprovedEmailInput = {
  employeeName: string;
  leaveType: LeaveType;
  start: string;
  end: string;
  workingDays: number;
  approvedBy: string;
  approvedAt: string;
};

export function leaveApprovedEmail(input: LeaveApprovedEmailInput): { subject: string; html: string } {
  const subject = "Your Leave Request Has Been Approved";
  const details =
    detailRow("Employee", escapeHtml(input.employeeName)) +
    detailRow("Leave type", escapeHtml(LEAVE_LABELS[input.leaveType])) +
    detailRow("Approved dates", escapeHtml(formatDateRange(input.start, input.end))) +
    detailRow("Working days", String(input.workingDays)) +
    detailRow("Approved by", escapeHtml(input.approvedBy)) +
    detailRow("Approval date", escapeHtml(formatSubmittedAt(input.approvedAt)));
  const html = layout({
    title: subject,
    heading: "Leave Request Approved",
    intro: `Hello ${escapeHtml(input.employeeName)}, your leave request has been approved. Please plan your work accordingly.`,
    detailsHtml: details,
  });
  return { subject, html };
}

export type LeaveRejectedEmailInput = {
  employeeName: string;
  leaveType: LeaveType;
  start: string;
  end: string;
  workingDays: number;
  rejectionReason: string;
  decidedAt: string;
};

export function leaveRejectedEmail(input: LeaveRejectedEmailInput): { subject: string; html: string } {
  const subject = "Update on Your Leave Request";
  const details =
    detailRow("Employee", escapeHtml(input.employeeName)) +
    detailRow("Leave type", escapeHtml(LEAVE_LABELS[input.leaveType])) +
    detailRow("Requested dates", escapeHtml(formatDateRange(input.start, input.end))) +
    detailRow("Working days", String(input.workingDays)) +
    detailRow("Rejection reason", escapeHtml(input.rejectionReason)) +
    detailRow("Decision date", escapeHtml(formatSubmittedAt(input.decidedAt)));
  const html = layout({
    title: subject,
    heading: "Leave Request Not Approved",
    intro: `Hello ${escapeHtml(input.employeeName)}, your leave request could not be approved. Details are below.`,
    detailsHtml: details,
  });
  return { subject, html };
}
