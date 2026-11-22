import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canAssignTaskAs, canEditOrDeleteOwnTaskAs, canManageTaskAs, type TaskManageFacts } from "./task-permissions.ts";

const ME = "me";
const none: TaskManageFacts = { createdBy: "sa", projectOwnerId: null, projectCreatedBy: "sa", assignees: [{ userId: "iv", assignedBy: "sa" }] };
const ownCreated: TaskManageFacts = { ...none, createdBy: ME };

describe("canManageTaskAs (mirrors private.can_manage_task, 046)", () => {
  it("no longer lets super admins manage tasks (monitoring-only as of Phase 2)", () => {
    assert.equal(canManageTaskAs("SUPER_ADMIN", ME, none), false);
    assert.equal(canManageTaskAs("SUPER_ADMIN", ME, ownCreated), false);
  });

  it("never lets an operational manager manage a task through this path", () => {
    assert.equal(canManageTaskAs("OPERATIONAL_MANAGER", ME, ownCreated), false);
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

describe("canAssignTaskAs (mirrors private.can_assign_task, 044)", () => {
  it("never lets super admins assign (monitoring-only)", () => {
    assert.equal(canAssignTaskAs("SUPER_ADMIN", ME, none), false);
  });

  it("lets an operational manager assign any task, company-wide", () => {
    assert.equal(canAssignTaskAs("OPERATIONAL_MANAGER", ME, none), true);
    assert.equal(canAssignTaskAs("OPERATIONAL_MANAGER", ME, ownCreated), true);
  });

  it("preserves admin's existing ownership-based assignment rights unchanged", () => {
    assert.equal(canAssignTaskAs("ADMIN", ME, none), false);
    assert.equal(canAssignTaskAs("ADMIN", ME, ownCreated), true);
  });

  it("never lets individuals assign", () => {
    assert.equal(canAssignTaskAs("INDIVIDUAL", ME, ownCreated), false);
  });
});

describe("canEditOrDeleteOwnTaskAs (mirrors private.can_edit_or_delete_own_task, 045)", () => {
  it("never lets super admins edit or delete (monitoring-only)", () => {
    assert.equal(canEditOrDeleteOwnTaskAs("SUPER_ADMIN", ME, ownCreated), false);
  });

  it("lets an operational manager edit or delete only tasks they personally created", () => {
    assert.equal(canEditOrDeleteOwnTaskAs("OPERATIONAL_MANAGER", ME, ownCreated), true);
    assert.equal(canEditOrDeleteOwnTaskAs("OPERATIONAL_MANAGER", ME, none), false);
    // Being an assignee, or owning/creating the project, is not enough -
    // only the task's own creator qualifies for Operational Manager.
    assert.equal(canEditOrDeleteOwnTaskAs("OPERATIONAL_MANAGER", ME, { ...none, projectOwnerId: ME }), false);
  });

  it("preserves admin's existing ownership-based edit/delete rights unchanged", () => {
    assert.equal(canEditOrDeleteOwnTaskAs("ADMIN", ME, none), false);
    assert.equal(canEditOrDeleteOwnTaskAs("ADMIN", ME, ownCreated), true);
    assert.equal(canEditOrDeleteOwnTaskAs("ADMIN", ME, { ...none, projectOwnerId: ME }), true);
  });

  it("never lets individuals edit or delete", () => {
    assert.equal(canEditOrDeleteOwnTaskAs("INDIVIDUAL", ME, ownCreated), false);
  });
});
