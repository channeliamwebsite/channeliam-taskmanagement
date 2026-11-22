import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { departmentWorkspacesOf, mergeCompanyMembers } from "./company-members.ts";

type FakeWorkspace = { id: string; isPersonal: boolean };
type FakeMember = { userId: string; fullName: string | null; email: string | null; team: string | null };

function ws(id: string, isPersonal = false): FakeWorkspace {
  return { id, isPersonal };
}

function member(userId: string, fullName: string, team: string | null = null): FakeMember {
  return { userId, fullName, email: null, team };
}

describe("departmentWorkspacesOf", () => {
  it("keeps only non-personal (department) workspaces", () => {
    const workspaces = [ws("creatives"), ws("om-personal", true), ws("engineering")];
    assert.deepEqual(departmentWorkspacesOf(workspaces).map((w) => w.id), ["creatives", "engineering"]);
  });

  it("excludes every personal workspace, not just the caller's own", () => {
    assert.deepEqual(departmentWorkspacesOf([ws("om-a-personal", true), ws("om-b-personal", true)]), []);
  });
});

describe("mergeCompanyMembers", () => {
  it("aggregates employees across every department workspace, attributing each to its own workspace", () => {
    const result = mergeCompanyMembers([
      { workspaceId: "creatives", members: [member("u1", "Asha", "Creatives")] },
      { workspaceId: "engineering", members: [member("u2", "Bala", "Engineering")] },
    ]);
    assert.deepEqual(
      result.map((m) => [m.userId, m.workspaceId, m.team]),
      [
        ["u1", "creatives", "Creatives"],
        ["u2", "engineering", "Engineering"],
      ],
    );
  });

  it("produces exactly one row for a user who is a member of more than one department workspace", () => {
    const result = mergeCompanyMembers([
      { workspaceId: "creatives", members: [member("u1", "Asha", "Creatives")] },
      { workspaceId: "engineering", members: [member("u1", "Asha", "Engineering")] },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.workspaceId, "creatives");
  });

  it("includes an employee with no tasks of their own, same as anyone else (membership-based, not task-based)", () => {
    const result = mergeCompanyMembers([{ workspaceId: "creatives", members: [member("u1", "Asha")] }]);
    assert.equal(result.length, 1);
  });

  it("sorts the merged list by name", () => {
    const result = mergeCompanyMembers([{ workspaceId: "creatives", members: [member("u2", "Zara"), member("u1", "Asha")] }]);
    assert.deepEqual(result.map((m) => m.fullName), ["Asha", "Zara"]);
  });

  it("returns nothing for an empty company (no department workspaces)", () => {
    assert.deepEqual(mergeCompanyMembers([]), []);
  });
});
