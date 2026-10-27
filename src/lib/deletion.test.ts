import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countOutsideDependencies, describeImpact, withDescendants } from "./deletion.ts";

const tree = [
  { id: "p", parentId: null },
  { id: "s1", parentId: "p" },
  { id: "s2", parentId: "p" },
  { id: "n", parentId: "s1" },
  { id: "other", parentId: null },
];

describe("withDescendants", () => {
  it("includes every nested subtask and nothing else", () => {
    assert.deepEqual(withDescendants(tree, ["p"]).sort(), ["n", "p", "s1", "s2"]);
    assert.deepEqual(withDescendants(tree, ["s1"]).sort(), ["n", "s1"]);
    assert.deepEqual(withDescendants(tree, ["other"]), ["other"]);
  });

  it("terminates on a cycle", () => {
    const cyclic = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    assert.deepEqual(withDescendants(cyclic, ["a"]).sort(), ["a", "b"]);
  });
});

describe("countOutsideDependencies", () => {
  it("counts only links that cross the deleted set", () => {
    const deps = [
      { taskId: "s1", dependsOnTaskId: "s2" }, // both deleted
      { taskId: "other", dependsOnTaskId: "p" }, // other stays
      { taskId: "n", dependsOnTaskId: "other" }, // other stays
      { taskId: "x", dependsOnTaskId: "y" }, // unrelated
    ];
    assert.equal(countOutsideDependencies(deps, new Set(["p", "s1", "s2", "n"])), 2);
  });
});

describe("describeImpact", () => {
  it("lists only what is removed, with correct plurals", () => {
    assert.deepEqual(
      describeImpact({ tasks: 3, subtasks: 1, comments: 1, attachments: 0, timeEntries: 2, outsideDependencies: 1 }),
      ["3 tasks (including 1 subtask)", "1 comment", "2 time entries", "1 dependency link to other tasks (those tasks are kept)"],
    );
    assert.deepEqual(describeImpact({ tasks: 0, subtasks: 2, comments: 0, attachments: 0, timeEntries: 1, outsideDependencies: 0 }), [
      "2 subtasks",
      "1 time entry",
    ]);
    assert.deepEqual(describeImpact({ tasks: 0, subtasks: 0, comments: 0, attachments: 0, timeEntries: 0, outsideDependencies: 0 }), []);
  });
});
