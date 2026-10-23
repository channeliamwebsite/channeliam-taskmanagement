import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { combineProgress, countLeafTasks, hasDerivedProgress, isLeafTask, percent, taskProgress } from "./progress.ts";

describe("percent", () => {
  it("rounds and handles an empty denominator", () => {
    assert.equal(percent(1, 3), 33);
    assert.equal(percent(2, 3), 67);
    assert.equal(percent(0, 0), 0);
  });
});

describe("taskProgress", () => {
  it("derives a parent's progress from its subtasks, ignoring the manual value", () => {
    assert.equal(taskProgress({ status: "IN_PROGRESS", progress: 90, subtaskTotal: 4, subtaskDone: 1 }), 25);
    assert.equal(taskProgress({ status: "TODO", progress: 0, subtaskTotal: 2, subtaskDone: 2 }), 100);
    assert.equal(hasDerivedProgress({ subtaskTotal: 2 }), true);
  });

  it("uses the manual value for leaf tasks", () => {
    assert.equal(taskProgress({ status: "IN_PROGRESS", progress: 40, subtaskTotal: 0, subtaskDone: 0 }), 40);
    assert.equal(taskProgress({ status: "IN_PROGRESS", progress: 40 }), 40);
    assert.equal(isLeafTask({ subtaskTotal: 0 }), true);
    assert.equal(isLeafTask({}), true);
  });

  it("treats a completed leaf task as 100% and clamps odd values", () => {
    assert.equal(taskProgress({ status: "COMPLETED", progress: 10 }), 100);
    assert.equal(taskProgress({ status: "TODO", progress: 140 }), 100);
    assert.equal(taskProgress({ status: "TODO", progress: -5 }), 0);
  });
});

describe("countLeafTasks (no double counting of parents and subtasks)", () => {
  const t = (id: string, project: string, status: string, parentTaskId: string | null = null) => ({ id, project, status, parentTaskId });

  it("counts subtasks instead of their parent", () => {
    const tasks = [
      t("homepage", "web", "IN_PROGRESS"),
      t("hero", "web", "COMPLETED", "homepage"),
      t("footer", "web", "TODO", "homepage"),
      t("seo", "web", "TODO"),
    ];
    assert.deepEqual(countLeafTasks(tasks, (x) => x.project).get("web"), { total: 3, completed: 1 });
  });

  it("handles nested subtasks: only the deepest tasks count", () => {
    const tasks = [
      t("a", "p", "TODO"),
      t("b", "p", "TODO", "a"),
      t("c", "p", "COMPLETED", "b"),
      t("d", "p", "COMPLETED", "b"),
    ];
    assert.deepEqual(countLeafTasks(tasks, (x) => x.project).get("p"), { total: 2, completed: 2 });
  });

  it("counts a parent as a leaf when it has no remaining subtasks in the list", () => {
    assert.deepEqual(countLeafTasks([t("solo", "p", "COMPLETED")], (x) => x.project).get("p"), { total: 1, completed: 1 });
  });

  it("groups separately and returns nothing for empty input", () => {
    const counts = countLeafTasks([t("x", "p1", "TODO"), t("y", "p2", "COMPLETED")], (x) => x.project);
    assert.deepEqual([...counts.entries()], [["p1", { total: 1, completed: 0 }], ["p2", { total: 1, completed: 1 }]]);
    assert.equal(countLeafTasks([], (x: { id: string; parentTaskId: null; status: string }) => x.id).size, 0);
  });
});

describe("combineProgress (client totals across projects)", () => {
  it("adds up projects and computes the percentage", () => {
    assert.deepEqual(combineProgress([{ total: 3, completed: 1 }, { total: 1, completed: 1 }]), { total: 4, completed: 2, progress: 50 });
  });

  it("is safe for clients without projects or tasks", () => {
    assert.deepEqual(combineProgress([]), { total: 0, completed: 0, progress: 0 });
    assert.deepEqual(combineProgress([{ total: 0, completed: 0 }]), { total: 0, completed: 0, progress: 0 });
  });
});
