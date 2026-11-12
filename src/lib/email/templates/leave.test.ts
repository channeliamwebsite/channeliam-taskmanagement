import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { escapeHtml, leaveApprovedEmail, leaveRejectedEmail, leaveRequestedEmail } from "./leave.ts";

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    assert.equal(escapeHtml(`<b>"O'Brien" & co</b>`), "&lt;b&gt;&quot;O&#39;Brien&quot; &amp; co&lt;/b&gt;");
  });
});

describe("leaveRequestedEmail", () => {
  const input = {
    employeeName: "Asha Rao",
    employeeCode: "CH-0007",
    department: "Creatives",
    leaveType: "CL" as const,
    start: "2026-12-01",
    end: "2026-12-02",
    workingDays: 2,
    reason: "Family function",
    submittedAt: "2026-11-10T09:00:00Z",
    reviewUrl: "https://taskmanager.likesandshares.com/hr/leave",
  };

  it("includes the subject with employee name and code", () => {
    const { subject } = leaveRequestedEmail(input);
    assert.equal(subject, "New Leave Request – Asha Rao – CH-0007");
  });

  it("includes every required detail and the review link", () => {
    const { html } = leaveRequestedEmail(input);
    for (const needle of ["Asha Rao", "CH-0007", "Creatives", "Casual Leave", "Family function", "Review Leave Request", input.reviewUrl]) {
      assert.ok(html.includes(needle), `expected html to include ${needle}`);
    }
  });

  it("escapes a reason containing HTML-significant characters", () => {
    const { html } = leaveRequestedEmail({ ...input, reason: `<script>alert(1)</script>` });
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });
});

describe("leaveApprovedEmail", () => {
  it("includes the approver and approval details", () => {
    const { subject, html } = leaveApprovedEmail({
      employeeName: "Asha Rao",
      leaveType: "WFH",
      start: "2026-12-01",
      end: "2026-12-01",
      workingDays: 1,
      approvedBy: "Priya Nair",
      approvedAt: "2026-11-10T09:00:00Z",
    });
    assert.equal(subject, "Your Leave Request Has Been Approved");
    for (const needle of ["Asha Rao", "Work From Home", "Priya Nair", "plan your work accordingly"]) {
      assert.ok(html.includes(needle), `expected html to include ${needle}`);
    }
  });
});

describe("leaveRejectedEmail", () => {
  it("includes the rejection reason", () => {
    const { subject, html } = leaveRejectedEmail({
      employeeName: "Asha Rao",
      leaveType: "LWP",
      start: "2026-12-01",
      end: "2026-12-03",
      workingDays: 3,
      rejectionReason: "Team is short-staffed that week",
      decidedAt: "2026-11-10T09:00:00Z",
    });
    assert.equal(subject, "Update on Your Leave Request");
    assert.ok(html.includes("Team is short-staffed that week"));
  });
});
