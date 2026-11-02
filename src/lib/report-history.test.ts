import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildHistoryEntry,
  buildReportRoster,
  firstSubmissionTime,
  historyMonth,
  historyNavigation,
  historyRange,
  readEveningSnapshot,
  reportTaskLabel,
  updatedAfterSubmission,
  type HistoryReportRow,
  type RosterMember,
} from "./report-history.ts";

const m = (userId: string, o: Partial<RosterMember> = {}): RosterMember => ({ userId, isActive: true, managerId: null, team: null, ...o });
const SA = { userId: "sa", role: "SUPER_ADMIN" as const, team: null };
const ADMIN = { userId: "ad", role: "ADMIN" as const, team: "Creatives" };

describe("buildReportRoster (historical reports stay visible)", () => {
  const members = [
    m("sa"),
    m("ad", { team: "Creatives" }),
    m("ivy", { team: "Creatives" }),
    m("gone", { isActive: false, team: "Creatives" }),
    m("idle", { isActive: false, team: "Creatives" }),
    m("desk", { team: "News Desk" }),
    m("desk-old", { isActive: false, team: "News Desk" }),
  ];

  it("keeps a deactivated employee who has a report for the date, labelled inactive", () => {
    const roster = buildReportRoster(members, ["gone"], SA);
    assert.deepEqual(roster.find((e) => e.userId === "gone")?.state, "inactive");
  });

  it("omits deactivated employees with no report for the date", () => {
    assert.equal(buildReportRoster(members, [], SA).some((e) => e.userId === "idle"), false);
  });

  it("still lists every active employee in scope, report or not", () => {
    assert.deepEqual(
      buildReportRoster(members, [], SA).map((e) => e.userId),
      ["sa", "ad", "ivy", "desk"],
    );
  });

  it("shows people removed from the workspace to super admins only", () => {
    assert.deepEqual(buildReportRoster(members, ["former"], SA).at(-1), { userId: "former", member: null, state: "removed" });
    assert.equal(buildReportRoster(members, ["former"], ADMIN).some((e) => e.userId === "former"), false);
  });

  it("keeps the admin's existing scope for inactive employees", () => {
    const roster = buildReportRoster(members, ["gone", "desk-old"], ADMIN);
    assert.deepEqual(roster.map((e) => `${e.userId}:${e.state}`), ["ad:active", "ivy:active", "gone:inactive"]);
  });

  it("includes inactive direct reports outside the admin's department", () => {
    const roster = buildReportRoster([...members, m("report", { isActive: false, managerId: "ad", team: "News Desk" })], ["report"], ADMIN);
    assert.equal(roster.find((e) => e.userId === "report")?.state, "inactive");
  });
});

describe("firstSubmissionTime (resubmission keeps the original time)", () => {
  it("uses now for a first submission", () => {
    assert.equal(firstSubmissionTime(null, "2026-10-22T10:00:00Z"), "2026-10-22T10:00:00Z");
    assert.equal(firstSubmissionTime(undefined, "2026-10-22T10:00:00Z"), "2026-10-22T10:00:00Z");
  });

  it("keeps an existing submission time on resubmission", () => {
    assert.equal(firstSubmissionTime("2026-10-22T03:40:00Z", "2026-10-22T12:00:00Z"), "2026-10-22T03:40:00Z");
  });
});

describe("reportTaskLabel", () => {
  const titles = new Map([["t1", "Homepage"]]);
  it("shows the title when the viewer can see the task", () => {
    assert.equal(reportTaskLabel("t1", titles, true), "Homepage");
    assert.equal(reportTaskLabel("t1", titles, false), "Homepage");
  });
  it("says (deleted task) when the viewer can see every task, so a missing one was deleted", () => {
    assert.equal(reportTaskLabel("t2", titles, true), "(deleted task)");
  });
  it("keeps (task) when the task may just be hidden from the viewer", () => {
    assert.equal(reportTaskLabel("t2", titles, false), "(task)");
  });
});

describe("updatedAfterSubmission", () => {
  it("is false when the row was only saved at submission time", () => {
    assert.equal(updatedAfterSubmission("2026-10-22T03:40:00.500Z", "2026-10-22T03:40:00.000Z"), false);
  });
  it("is true when the report was saved again later", () => {
    assert.equal(updatedAfterSubmission("2026-10-22T05:00:00Z", "2026-10-22T03:40:00Z", "2026-10-22T04:00:00Z"), true);
  });
  it("compares against the latest submission and ignores missing ones", () => {
    assert.equal(updatedAfterSubmission("2026-10-22T12:30:00Z", null, "2026-10-22T12:30:00Z"), false);
    assert.equal(updatedAfterSubmission(null, "2026-10-22T03:40:00Z"), false);
    assert.equal(updatedAfterSubmission("2026-10-22T05:00:00Z"), false);
  });
});

describe("readEveningSnapshot (snapshot first, live lookup as fallback)", () => {
  const snapshot = {
    version: 1,
    captured_at: "2026-10-22T13:00:00+00:00",
    timezone: "Asia/Kolkata",
    reporter_team: "Creatives",
    tasks: [
      { id: "t1", title: "Homepage", status: "COMPLETED", priority: "HIGH", completed_at: "2026-10-22T12:00:00+00:00" },
      { id: "t2", title: "Footer", status: "BLOCKED", priority: "URGENT", completed_at: null },
    ],
  };

  it("returns the tasks as they were at submission", () => {
    const s = readEveningSnapshot(snapshot);
    assert.deepEqual(s?.tasks.map((t) => `${t.title}:${t.status}`), ["Homepage:COMPLETED", "Footer:BLOCKED"]);
    assert.equal(s?.reporterTeam, "Creatives");
    assert.equal(s?.tasks[0].completedAt, "2026-10-22T12:00:00+00:00");
  });

  it("returns null for reports without a snapshot so the live lookup is used", () => {
    assert.equal(readEveningSnapshot(null), null);
    assert.equal(readEveningSnapshot(undefined), null);
  });

  it("returns null for unknown versions or shapes", () => {
    assert.equal(readEveningSnapshot({ version: 2, tasks: [] }), null);
    assert.equal(readEveningSnapshot({ version: 1 }), null);
    assert.equal(readEveningSnapshot([]), null);
    assert.equal(readEveningSnapshot("x"), null);
  });

  it("skips malformed task entries instead of failing", () => {
    const s = readEveningSnapshot({ version: 1, tasks: [{ id: "t1" }, null, { id: "t2", title: "Ok", status: "TODO" }] });
    assert.deepEqual(s?.tasks.map((t) => t.id), ["t2"]);
  });
});

describe("historyMonth / historyRange (own report history)", () => {
  const today = "2026-10-30";

  it("accepts a valid past or current month", () => {
    assert.equal(historyMonth("2026-07", today), "2026-07");
    assert.equal(historyMonth("2025-12", today), "2025-12");
    assert.equal(historyMonth("2026-10", today), "2026-10");
  });

  it("falls back to the current month for invalid input", () => {
    for (const bad of [undefined, null, "", "2026-13", "2026-00", "2026-7", "26-07", "2026-07-01", ["2026-07"], "x"]) {
      assert.equal(historyMonth(bad, today), "2026-10", String(bad));
    }
  });

  it("never moves past the current month", () => {
    assert.equal(historyMonth("2026-11", today), "2026-10");
    assert.equal(historyMonth("2031-01", today), "2026-10");
  });

  it("covers the whole month, stopping at today for the current one", () => {
    assert.deepEqual(historyRange("2026-09", today), { first: "2026-09-01", last: "2026-09-30" });
    assert.deepEqual(historyRange("2024-02", today), { first: "2024-02-01", last: "2024-02-29" });
    assert.deepEqual(historyRange("2026-10", today), { first: "2026-10-01", last: "2026-10-30" });
  });

  it("handles year boundaries", () => {
    assert.deepEqual(historyRange("2025-12", "2026-01-05"), { first: "2025-12-01", last: "2025-12-31" });
    assert.equal(historyMonth("2026-01", "2025-12-31"), "2025-12");
  });
});

describe("historyNavigation", () => {
  it("links to the previous and next month", () => {
    assert.deepEqual(historyNavigation("2026-07", "2026-10-30"), { previous: "2026-06", next: "2026-08" });
  });
  it("has no next month on the current month", () => {
    assert.deepEqual(historyNavigation("2026-10", "2026-10-30"), { previous: "2026-09", next: null });
  });
  it("crosses year boundaries", () => {
    assert.deepEqual(historyNavigation("2026-01", "2026-10-30"), { previous: "2025-12", next: "2026-02" });
    assert.deepEqual(historyNavigation("2025-12", "2026-01-02"), { previous: "2025-11", next: "2026-01" });
  });
  it("still offers the current month from the month before it on the first day", () => {
    assert.deepEqual(historyNavigation("2026-09", "2026-10-01"), { previous: "2026-08", next: "2026-10" });
  });
});

describe("buildHistoryEntry", () => {
  const base: HistoryReportRow = {
    id: "r1",
    report_date: "2026-10-20",
    total_hours: 7.5,
    tasks_completed: 2,
    tasks_in_progress: 1,
    tasks_blocked: 0,
    morning_plan: "Finish the banner",
    planned_task_ids: ["t1", "t9"],
    accomplishments: "Banner done",
    work_remaining: null,
    blockers: "  ",
    tomorrow_plan: "Start the brochure",
    linked_task_ids: ["t1"],
    morning_submitted_at: "2026-10-20T04:00:00Z",
    evening_submitted_at: "2026-10-20T13:00:00Z",
    updated_at: "2026-10-20T13:00:00Z",
    evening_snapshot: null,
  };
  const titles = new Map([["t1", "Banner"]]);
  const label = (id: string) => reportTaskLabel(id, titles, false);
  const status = (s: string) => (s === "COMPLETED" ? "Completed" : s);

  it("uses the evening snapshot when present (migration 009)", () => {
    const e = buildHistoryEntry(
      { ...base, evening_snapshot: { version: 1, tasks: [{ id: "t1", title: "Banner (old title)", status: "COMPLETED", completed_at: null }] } },
      label,
      status,
    );
    assert.equal(e.fromSnapshot, true);
    assert.deepEqual(e.sections.find((s) => s.label === "Tasks covered (as submitted)"), {
      label: "Tasks covered (as submitted)",
      text: "Banner (old title) (Completed)",
    });
  });

  it("falls back to linked task ids for reports from before migration 009", () => {
    const e = buildHistoryEntry(base, label, status);
    assert.equal(e.fromSnapshot, false);
    assert.deepEqual(e.sections.find((s) => s.label === "Tasks covered"), { label: "Tasks covered", text: "Banner" });
  });

  it("labels tasks the person can no longer see without leaking anything", () => {
    const e = buildHistoryEntry(base, label, status);
    assert.equal(e.sections.find((s) => s.label === "Planned tasks")?.text, "Banner, (task)");
  });

  it("leaves out empty and whitespace-only sections, in display order", () => {
    const e = buildHistoryEntry(base, label, status);
    assert.deepEqual(
      e.sections.map((s) => s.label),
      ["Planned tasks", "Plan notes", "Accomplishments", "Tomorrow's priorities", "Tasks covered"],
    );
  });

  it("shows stored counts only once the evening report is submitted", () => {
    assert.deepEqual(buildHistoryEntry(base, label, status).counts, { completed: 2, notCompleted: 1, blocked: 0 });
    assert.equal(buildHistoryEntry({ ...base, evening_submitted_at: null }, label, status).counts, null);
  });

  it("handles a row with nothing submitted (automatic morning snapshot only)", () => {
    const e = buildHistoryEntry(
      { ...base, morning_plan: null, planned_task_ids: [], accomplishments: null, tomorrow_plan: null, linked_task_ids: null, morning_submitted_at: null, evening_submitted_at: null, blockers: null, total_hours: 0 },
      label,
      status,
    );
    assert.deepEqual(e.sections, []);
    assert.equal(e.counts, null);
    assert.equal(e.totalHours, 0);
    assert.equal(e.updatedAt, null);
  });

  it("reports a later update after submission", () => {
    assert.equal(buildHistoryEntry({ ...base, updated_at: "2026-10-20T15:00:00Z" }, label, status).updatedAt, "2026-10-20T15:00:00Z");
    assert.equal(buildHistoryEntry(base, label, status).updatedAt, null);
  });
});
