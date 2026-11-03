import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canManageTaskAs, type TaskManageFacts } from "./task-permissions.ts";

const ME = "me";
const none: TaskManageFacts = { createdBy: "sa", projectOwnerId: null, projectCreatedBy: "sa", assignees: [{ userId: "iv", assignedBy: "sa" }] };

describe("canManageTaskAs (mirrors private.can_manage_task)", () => {
  it("lets super admins manage every task", () => {
    assert.equal(canManageTaskAs("SUPER_ADMIN", ME, none), true);
  });

  it("lets admins manage only tasks they are involved in", () => {
    assert.equal(canManageTaskAs("ADMIN", ME, none), false);
    assert.equal(canManageTaskAs("ADMIN", ME, { ...none, createdBy: ME }), true);
    assert.equal(canManageTaskAs("ADMIN", ME, { ...none, projectOwnerId: ME }), true);
    assert.equal(canManageTaskAs("ADMIN", ME, { ...none, projectCreatedBy: ME }), true);
    assert.equal(canManageTaskAs("ADMIN", ME, { ...none, assignees: [{ userId: ME, assignedBy: "sa" }] }), true);
    assert.equal(canManageTaskAs("ADMIN", ME, { ...none, assignees: [{ userId: "iv", assignedBy: ME }] }), true);
  });

  it("never lets individuals manage tasks, even their own", () => {
    assert.equal(canManageTaskAs("INDIVIDUAL", ME, { ...none, createdBy: ME, assignees: [{ userId: ME, assignedBy: ME }] }), false);
  });
});
