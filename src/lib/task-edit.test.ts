import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planTaskEdit, type EditableTaskValues } from "./task-edit.ts";

const loaded: EditableTaskValues = {
  title: "Homepage",
  description: null,
  status: "TODO",
  priority: "MEDIUM",
  task_type: "TASK",
  start_date: "2026-10-12",
  scheduled_date: "2026-10-12",
  due_date: "2026-10-20",
  estimated_hours: null,
  parent_task_id: null,
};

describe("planTaskEdit (stale edit form vs concurrent changes)", () => {
  it("regression: a stale form does not overwrite a newer status set by someone else", () => {
    // User A opens the form while the task is TODO; user B then marks it BLOCKED.
    const current = { ...loaded, status: "BLOCKED" };
    // User A only renames the task and saves the form, which still says TODO.
    const submitted = { ...loaded, title: "Homepage v2" };
    const plan = planTaskEdit(loaded, submitted, current);
    assert.deepEqual(plan.changes, { title: "Homepage v2" }, "only the renamed field is written");
    assert.equal("status" in plan.changes, false, "the stale TODO status is not written back");
    assert.deepEqual(plan.conflicts, []);
  });

  it("reports a conflict when both users changed the same field to different values", () => {
    const current = { ...loaded, status: "BLOCKED" };
    const submitted = { ...loaded, status: "IN_REVIEW", title: "Homepage v2" };
    const plan = planTaskEdit(loaded, submitted, current);
    assert.deepEqual(plan.conflicts, ["status"]);
  });

  it("is not a conflict when both users made the same change", () => {
    const current = { ...loaded, status: "COMPLETED" };
    const submitted = { ...loaded, status: "COMPLETED" };
    const plan = planTaskEdit(loaded, submitted, current);
    assert.deepEqual(plan.conflicts, []);
    assert.deepEqual(plan.changes, { status: "COMPLETED" });
  });

  it("writes nothing when the user changed nothing", () => {
    const current = { ...loaded, priority: "URGENT", due_date: "2026-10-25" };
    assert.deepEqual(planTaskEdit(loaded, { ...loaded }, current), { changes: {}, conflicts: [] });
  });

  it("applies the user's change when no one else touched that field", () => {
    const current = { ...loaded };
    const submitted = { ...loaded, status: "IN_PROGRESS", due_date: "2026-10-22" };
    assert.deepEqual(planTaskEdit(loaded, submitted, current).changes, { status: "IN_PROGRESS", due_date: "2026-10-22" });
  });

  it("handles cleared values and numeric formatting", () => {
    const base = { ...loaded, estimated_hours: 2, description: "Notes" };
    const current = { ...base, estimated_hours: 2 };
    const submitted = { ...base, estimated_hours: "2.00" as unknown as number, description: null };
    const plan = planTaskEdit(base, submitted, current);
    assert.deepEqual(plan.changes, { description: null }, "2 and 2.00 are the same estimate; clearing the description is a change");
  });

  it("lists every conflicting field", () => {
    const current = { ...loaded, status: "BLOCKED", due_date: "2026-10-30" };
    const submitted = { ...loaded, status: "IN_PROGRESS", due_date: "2026-10-21", title: "x" };
    assert.deepEqual(planTaskEdit(loaded, submitted, current).conflicts, ["status", "due_date"]);
  });
});
