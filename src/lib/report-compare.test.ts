import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareReport, hasSubmission, isExpectedReporter, summarizeComparisons, type ReportInput } from "./report-compare.ts";
import type { EveningSnapshot } from "./report-history.ts";

const titleOf = (id: string) => `Title of ${id}`;
const snap = (tasks: [string, string][]): EveningSnapshot => ({
  capturedAt: "2026-10-27T12:30:00Z",
  reporterTeam: null,
  tasks: tasks.map(([id, status]) => ({ id, title: `Task ${id}`, status, completedAt: null })),
});
const report = (o: Partial<ReportInput>): ReportInput => ({
  morningSubmittedAt: "2026-10-27T03:30:00Z",
  eveningSubmittedAt: "2026-10-27T12:30:00Z",
  plannedTaskIds: [],
  snapshot: null,
  ...o,
});

describe("compareReport", () => {
  it("marks people without any report as not submitted (no outcome is invented)", () => {
    const c = compareReport(null, titleOf);
    assert.equal(c.submission, "none");
    assert.equal(c.outcome, null);
    assert.deepEqual([c.planned, c.completed, c.pending], [[], [], []]);
  });

  it("shows a morning plan without an evening report as evening missing, with no outcome", () => {
    const c = compareReport(report({ eveningSubmittedAt: null, plannedTaskIds: ["a", "b"] }), titleOf);
    assert.equal(c.submission, "morning_only");
    assert.equal(c.outcome, null);
    assert.deepEqual(c.planned.map((t) => [t.title, t.status]), [["Title of a", null], ["Title of b", null]]);
  });

  it("compares the planned tasks with their evening status", () => {
    const s = snap([["a", "COMPLETED"], ["b", "IN_PROGRESS"], ["c", "COMPLETED"]]);
    const c = compareReport(report({ plannedTaskIds: ["a", "b"], snapshot: s }), titleOf);
    assert.equal(c.submission, "both");
    assert.equal(c.outcome, "partial");
    assert.equal(c.basedOnPlan, true);
    assert.equal(c.plannedCompleted, 1);
    assert.deepEqual(c.completed.map((t) => t.id), ["a", "c"], "completed work includes unplanned tasks done that day");
    assert.deepEqual(c.pending.map((t) => t.id), ["b"]);
  });

  it("distinguishes completed, blocked and pending days", () => {
    assert.equal(compareReport(report({ plannedTaskIds: ["a"], snapshot: snap([["a", "COMPLETED"]]) }), titleOf).outcome, "completed");
    assert.equal(
      compareReport(report({ plannedTaskIds: ["a", "b"], snapshot: snap([["a", "COMPLETED"], ["b", "BLOCKED"]]) }), titleOf).outcome,
      "blocked",
    );
    assert.equal(compareReport(report({ plannedTaskIds: ["a"], snapshot: snap([["a", "TODO"]]) }), titleOf).outcome, "pending");
  });

  it("keeps a planned task that left the evening report as not completed (status unknown)", () => {
    const c = compareReport(report({ plannedTaskIds: ["a", "gone"], snapshot: snap([["a", "COMPLETED"]]) }), titleOf);
    assert.equal(c.outcome, "partial");
    assert.deepEqual(c.planned.find((t) => t.id === "gone"), { id: "gone", title: "Title of gone", status: null });
  });

  it("uses the evening's own tasks when there was no morning plan", () => {
    const c = compareReport(report({ morningSubmittedAt: null, snapshot: snap([["x", "COMPLETED"]]) }), titleOf);
    assert.equal(c.submission, "evening_only");
    assert.equal(c.basedOnPlan, false);
    assert.equal(c.outcome, "completed");
  });

  it("does not guess for evening reports without a task snapshot (older reports)", () => {
    const c = compareReport(report({ plannedTaskIds: ["a"], snapshot: null }), titleOf);
    assert.equal(c.outcome, "unknown");
    assert.equal(c.plannedCompleted, 0);
  });
});

describe("summarizeComparisons", () => {
  it("counts submissions and planned work over the expected employees only", () => {
    const both = compareReport(report({ plannedTaskIds: ["a", "b"], snapshot: snap([["a", "COMPLETED"], ["b", "TODO"]]) }), titleOf);
    const morningOnly = compareReport(report({ eveningSubmittedAt: null, plannedTaskIds: ["c"] }), titleOf);
    const none = compareReport(null, titleOf);
    const outsider = compareReport(report({ plannedTaskIds: ["z"], snapshot: snap([["z", "COMPLETED"]]) }), titleOf);
    assert.deepEqual(
      summarizeComparisons([
        { expected: true, comparison: both },
        { expected: true, comparison: morningOnly },
        { expected: true, comparison: none },
        { expected: false, comparison: outsider },
      ]),
      { expected: 3, morningSubmitted: 2, eveningSubmitted: 1, plannedTasks: 2, plannedCompleted: 1, pendingTasks: 1, notSubmitted: 1 },
    );
  });
});

describe("who is expected to report (super admin monitoring)", () => {
  it("expects active Admins and Individuals only", () => {
    assert.equal(isExpectedReporter("ADMIN", "active"), true);
    assert.equal(isExpectedReporter("INDIVIDUAL", "active"), true);
    assert.equal(isExpectedReporter("SUPER_ADMIN", "active"), false, "super admins review; they do not report");
    assert.equal(isExpectedReporter("INDIVIDUAL", "inactive"), false);
    assert.equal(isExpectedReporter(null, "removed"), false);
  });

  it("does not treat an automatic morning snapshot as a submission", () => {
    assert.equal(hasSubmission({ morning_submitted_at: null, evening_submitted_at: null }), false, "snapshot-only row");
    assert.equal(hasSubmission({ morning_submitted_at: "2026-10-27T03:30:00Z", evening_submitted_at: null }), true);
    assert.equal(hasSubmission(null), false);
    const snapshotOnly = compareReport(report({ morningSubmittedAt: null, eveningSubmittedAt: null, plannedTaskIds: ["a"] }), titleOf);
    assert.equal(snapshotOnly.submission, "none");
    assert.deepEqual(snapshotOnly.planned, [], "the automatic snapshot is not shown as the employee's plan");
  });

  it("keeps totals independent of which rows the submission filter shows", () => {
    const all = [
      { expected: true, comparison: compareReport(report({ eveningSubmittedAt: null }), titleOf) },
      { expected: true, comparison: compareReport(null, titleOf) },
    ];
    const shownWhenFilteringMissing = all.filter((r) => r.comparison.submission === "none");
    assert.equal(shownWhenFilteringMissing.length, 1);
    assert.deepEqual(
      { expected: summarizeComparisons(all).expected, morning: summarizeComparisons(all).morningSubmitted },
      { expected: 2, morning: 1 },
      "the page computes totals over all in-scope rows, then filters the list",
    );
  });
});
