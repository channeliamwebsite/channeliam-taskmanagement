import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCompletedOn } from "./scheduling.ts";
import { buildTeamToday, teamTotals, type TeamTask } from "./team-today.ts";

const today = "2026-10-12";
const tz = "Asia/Kolkata";

describe("isCompletedOn (uses completed_at, not updated_at)", () => {
  it("matches the completion day in the workspace timezone", () => {
    // 20:00 UTC on the 11th is 01:30 on the 12th in India.
    assert.equal(isCompletedOn("2026-10-11T20:00:00Z", "2026-10-12", tz), true);
    assert.equal(isCompletedOn("2026-10-11T20:00:00Z", "2026-10-11", "UTC"), true);
    assert.equal(isCompletedOn("2026-10-11T10:00:00Z", today, tz), false);
    assert.equal(isCompletedOn(null, today, tz), false);
  });
});

function task(partial: Partial<TeamTask> & { id: string; assigneeIds: string[] }): TeamTask {
  return { status: "TODO", scheduledDate: today, dueDate: null, completedAt: null, ...partial };
}

describe("buildTeamToday", () => {
  const employees = [
    { userId: "u1", name: "Asha" },
    { userId: "u2", name: "Bala" },
  ];
  const tasks: TeamTask[] = [
    task({ id: "t-today", assigneeIds: ["u1"] }),
    task({ id: "t-progress", assigneeIds: ["u1"], status: "IN_PROGRESS" }),
    task({ id: "t-carried", assigneeIds: ["u1"], scheduledDate: "2026-10-09", dueDate: "2026-10-10" }),
    task({ id: "t-done-today", assigneeIds: ["u1"], status: "COMPLETED", completedAt: "2026-10-12T06:00:00Z" }),
    task({ id: "t-done-yesterday", assigneeIds: ["u1"], status: "COMPLETED", scheduledDate: "2026-10-11", completedAt: "2026-10-11T06:00:00Z" }),
    task({ id: "t-cancelled", assigneeIds: ["u1"], status: "CANCELLED", scheduledDate: "2026-10-01" }),
    task({ id: "t-future", assigneeIds: ["u1"], scheduledDate: "2026-10-20" }),
    task({ id: "t-blocked", assigneeIds: ["u2"], status: "BLOCKED" }),
    task({ id: "t-shared", assigneeIds: ["u1", "u2"] }),
  ];
  const reports = new Map([["u2", { morning: true, evening: true }], ["u1", { morning: true, evening: false }]]);
  const [asha, bala] = buildTeamToday(employees, tasks, reports, today, tz);

  it("counts today's workload, completions and carry-forward per employee", () => {
    // Pending: today, in-progress (scheduled today), carried, shared = 4; done today = 1.
    assert.equal(asha!.pending, 4);
    assert.equal(asha!.completedToday, 1);
    assert.equal(asha!.planned, 5);
    assert.equal(asha!.carriedForward, 1);
    assert.equal(asha!.overdue, 1);
    assert.equal(asha!.inProgress, 1);
    assert.equal(asha!.progress, 20);
  });

  it("never counts completed (other days), cancelled or future tasks as pending", () => {
    for (const id of ["t-done-yesterday", "t-cancelled", "t-future"]) {
      assert.equal(asha!.taskIds.includes(id), false, id);
    }
  });

  it("tracks blocked work and morning/evening submission", () => {
    assert.equal(bala!.blocked, 1);
    assert.equal(bala!.pending, 2); // blocked task (scheduled today) + shared task
    assert.equal(bala!.eveningSubmitted, true);
    assert.equal(asha!.morningSubmitted, true);
    assert.equal(asha!.eveningSubmitted, false);
  });

  it("reports 0% progress when nothing is planned", () => {
    const [idle] = buildTeamToday([{ userId: "u3", name: "Idle" }], tasks, new Map(), today, tz);
    assert.equal(idle!.planned, 0);
    assert.equal(idle!.progress, 0);
  });

  it("team totals count each task once, while employee rows count shared tasks per assignee", () => {
    // Rows: Asha planned 5 + Bala planned 2 = 7, but t-shared is the same task.
    assert.equal(asha!.planned + bala!.planned, 7);
    const totals = teamTotals([asha!, bala!], tasks, today, tz);
    assert.equal(totals.planned, 6);
    assert.equal(totals.pending, 5);
    assert.equal(totals.completed, 1);
    assert.equal(totals.blocked, 1);
    assert.equal(totals.carriedForward, 1);
    assert.equal(totals.overdue, 1);
    assert.equal(totals.morningSubmitted, 2);
    assert.equal(totals.eveningSubmitted, 1);
    assert.equal(totals.progress, 17);
  });

  it("team totals leave out parent tasks that have subtasks", () => {
    const withParent = [...tasks, task({ id: "t-parent", assigneeIds: ["u1"], hasSubtasks: true })];
    assert.equal(teamTotals([asha!, bala!], withParent, today, tz).planned, 6);
  });

  it("team totals only include tasks of employees in the view", () => {
    assert.equal(teamTotals([bala!], tasks, today, tz).planned, 2);
    assert.equal(teamTotals([], tasks, today, tz).planned, 0);
  });
});
