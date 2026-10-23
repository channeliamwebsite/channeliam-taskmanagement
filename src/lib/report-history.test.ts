import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildReportRoster, firstSubmissionTime, readEveningSnapshot, reportTaskLabel, updatedAfterSubmission, type RosterMember } from "./report-history.ts";

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
