import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTodaysWork, summarizeTracking, trackingLabel, type TrackingRow } from "./daily-tracking.ts";

const row = (o: Partial<TrackingRow> & Pick<TrackingRow, "taskId" | "tracking">): TrackingRow => ({
  userId: "u1",
  title: o.taskId,
  status: "TODO",
  priority: "MEDIUM",
  projectName: null,
  clientName: null,
  dueDate: null,
  assignedAt: null,
  morningStatus: o.tracking === "MORNING" || o.tracking === "REASSIGNED" || o.tracking === "CHANGED" || o.tracking === "REMOVED" ? "TODO" : null,
  morningGeneratedAt: "2026-10-23T03:30:00Z",
  eveningSubmittedAt: null,
  ...o,
});

describe("summarizeTracking (the test scenario A-E)", () => {
  const rows = [
    row({ taskId: "A", tracking: "MORNING", status: "COMPLETED" }),
    row({ taskId: "B", tracking: "MORNING", status: "IN_PROGRESS" }),
    row({ taskId: "C", tracking: "MORNING", status: "TODO" }),
    row({ taskId: "D", tracking: "REASSIGNED", status: "TODO" }),
    row({ taskId: "E", tracking: "ADDED", status: "TODO" }),
    row({ userId: "u2", taskId: "D", tracking: "ASSIGNED", status: "TODO" }),
  ];
  const [u1, u2] = summarizeTracking(["u1", "u2"], rows);

  it("counts the morning report, additions and current statuses", () => {
    assert.equal(u1!.morning, 4, "A-D were in the morning report");
    assert.equal(u1!.added, 1, "E was added during the day");
    assert.equal(u1!.completed, 1);
    assert.equal(u1!.inProgress, 1);
    assert.equal(u1!.pending, 2, "C and E");
    assert.equal(u1!.movedOut, 1, "D was reassigned away");
    assert.equal(u1!.progress, 25, "1 of today's 4 tasks completed");
  });

  it("gives the reassigned task to the new assignee only", () => {
    assert.equal(u2!.added, 1);
    assert.equal(u2!.pending, 1);
    assert.equal(u2!.morning, 0);
  });

  it("lists today's work before tasks that moved out", () => {
    assert.deepEqual(u1!.rows.map((r) => r.taskId), ["A", "B", "C", "E", "D"]);
  });
});

describe("summarizeTracking edge cases", () => {
  it("returns zeroes for employees with no rows", () => {
    const [x] = summarizeTracking(["nobody"], []);
    assert.deepEqual({ ...x, rows: x!.rows.length }, {
      userId: "nobody", morning: 0, added: 0, completed: 0, inProgress: 0, pending: 0, movedOut: 0, progress: 0,
      morningGeneratedAt: null, eveningSubmittedAt: null, rows: 0,
    });
  });

  it("shows report timestamps for an employee whose morning report has no tasks", () => {
    const [x] = summarizeTracking(["u1"], [], [
      { userId: "u1", morningGeneratedAt: "2026-10-23T05:00:00Z", eveningSubmittedAt: null },
    ]);
    assert.equal(x!.morningGeneratedAt, "2026-10-23T05:00:00Z");
    assert.equal(x!.morning, 0);
  });

  it("counts work completed before the morning report as completed, not added", () => {
    const [x] = summarizeTracking(["u1"], [
      row({ taskId: "P", tracking: "COMPLETED_EARLY", status: "COMPLETED" }),
      row({ taskId: "Q", tracking: "MORNING", status: "TODO" }),
    ]);
    assert.equal(x!.completed, 1);
    assert.equal(x!.added, 0);
    assert.equal(x!.morning, 1);
    assert.equal(x!.progress, 50);
  });

  it("counts created, assigned and moved-in tasks as added after the report", () => {
    const [x] = summarizeTracking(["u1"], [
      row({ taskId: "N", tracking: "ADDED" }),
      row({ taskId: "A", tracking: "ASSIGNED" }),
      row({ taskId: "M", tracking: "MOVED_IN" }),
    ]);
    assert.equal(x!.added, 3);
    assert.equal(x!.pending, 3);
  });

  it("treats in-review as in progress and blocked as pending", () => {
    const [x] = summarizeTracking(["u1"], [
      row({ taskId: "R", tracking: "MORNING", status: "IN_REVIEW" }),
      row({ taskId: "K", tracking: "CURRENT", status: "BLOCKED" }),
    ]);
    assert.equal(x!.inProgress, 1);
    assert.equal(x!.pending, 1);
  });
});

describe("labels", () => {
  it("labels only rows that need explaining", () => {
    assert.equal(trackingLabel("ADDED"), "Created during the day");
    assert.equal(trackingLabel("ASSIGNED"), "Assigned during the day");
    assert.equal(trackingLabel("MOVED_IN"), "Moved into today");
    assert.equal(trackingLabel("COMPLETED_EARLY"), "Completed before the morning report");
    assert.equal(trackingLabel("REASSIGNED"), "Reassigned");
    assert.equal(trackingLabel("MORNING"), null);
    assert.equal(isTodaysWork({ tracking: "CHANGED" }), false);
    assert.equal(isTodaysWork({ tracking: "CURRENT" }), true);
  });
});
