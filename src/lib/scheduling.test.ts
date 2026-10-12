import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCarriedForward, isInTodaysWorkload, taskFlags } from "./scheduling.ts";

const today = "2026-10-12";

describe("carry-forward", () => {
  it("carries forward unfinished work scheduled before today", () => {
    assert.equal(isCarriedForward({ scheduledDate: "2026-10-10", status: "IN_PROGRESS" }, today), true);
    assert.equal(isCarriedForward({ scheduledDate: "2026-10-11", status: "TODO" }, today), true);
    assert.equal(isCarriedForward({ scheduledDate: "2026-10-01", status: "BLOCKED" }, today), true);
  });

  it("never carries forward completed or cancelled tasks", () => {
    assert.equal(isCarriedForward({ scheduledDate: "2026-10-09", status: "COMPLETED" }, today), false);
    assert.equal(isCarriedForward({ scheduledDate: "2026-10-09", status: "CANCELLED" }, today), false);
  });

  it("does not carry forward tasks scheduled today, later, or unscheduled", () => {
    assert.equal(isCarriedForward({ scheduledDate: today, status: "TODO" }, today), false);
    assert.equal(isCarriedForward({ scheduledDate: "2026-10-13", status: "TODO" }, today), false);
    assert.equal(isCarriedForward({ scheduledDate: null, status: "TODO" }, today), false);
  });

  it("is idempotent: evaluating repeatedly never changes the task", () => {
    const task = Object.freeze({ scheduledDate: "2026-10-10", dueDate: "2026-10-20", status: "TODO" as const });
    for (let i = 0; i < 5; i++) assert.equal(isCarriedForward(task, today), true);
    assert.deepEqual(task, { scheduledDate: "2026-10-10", dueDate: "2026-10-20", status: "TODO" });
  });
});

describe("today's workload", () => {
  it("includes carried-forward, scheduled-today and unscheduled-due-today tasks", () => {
    assert.equal(isInTodaysWorkload({ scheduledDate: "2026-10-10", dueDate: null, status: "TODO" }, today), true);
    assert.equal(isInTodaysWorkload({ scheduledDate: today, dueDate: null, status: "IN_REVIEW" }, today), true);
    assert.equal(isInTodaysWorkload({ scheduledDate: null, dueDate: today, status: "TODO" }, today), true);
  });

  it("excludes done work, future work, and tasks scheduled later even if due today", () => {
    assert.equal(isInTodaysWorkload({ scheduledDate: today, dueDate: today, status: "COMPLETED" }, today), false);
    assert.equal(isInTodaysWorkload({ scheduledDate: "2026-10-13", dueDate: null, status: "TODO" }, today), false);
    assert.equal(isInTodaysWorkload({ scheduledDate: "2026-10-14", dueDate: today, status: "TODO" }, today), false);
  });
});

describe("task flags", () => {
  it("labels overdue and carried-forward tasks independently", () => {
    const flags = taskFlags({ scheduledDate: "2026-10-10", dueDate: "2026-10-11", status: "TODO" }, today);
    assert.deepEqual(
      flags.map((f) => f.tone),
      ["red", "amber"],
    );
    assert.match(flags[1]!.label, /Carried from Oct 10, 2026/);
  });

  it("has no flags for completed tasks even when past due", () => {
    assert.deepEqual(taskFlags({ scheduledDate: "2026-10-01", dueDate: "2026-10-02", status: "COMPLETED" }, today), []);
  });
});
