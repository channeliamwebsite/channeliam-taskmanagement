import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addEmployee, inviteAcceptUrl, validateEmployeeInput, type AddEmployeeDeps, type EmployeeInput } from "./employee-workflow.ts";

const input: EmployeeInput = {
  email: "new.person@channeliam.com",
  fullName: "New Person",
  team: "Creatives",
  jobTitle: "Designer",
  role: "INDIVIDUAL",
  managerId: null,
};

/** Fake dependencies recording every call; override any step. */
function deps(over: Partial<AddEmployeeDeps> = {}) {
  const calls: string[] = [];
  const d: AddEmployeeDeps = {
    findAccount: async () => (calls.push("find"), null),
    isMember: async () => (calls.push("isMember"), false),
    inviteByEmail: async () => (calls.push("invite"), { userId: "u-new" }),
    createInviteLink: async () => (calls.push("link"), { userId: "u-new", link: "https://app/auth/confirm?token_hash=x" }),
    addMembership: async () => (calls.push("membership"), null),
    applyProfile: async () => (calls.push("profile"), null),
    ...over,
  };
  return { d, calls };
}

describe("validateEmployeeInput", () => {
  it("normalises and accepts a complete employee", () => {
    const r = validateEmployeeInput({ email: "  New.Person@Channeliam.com ", fullName: " New  Person ", role: "ADMIN", team: " Creatives " });
    assert.deepEqual(r, {
      ok: true,
      value: { email: "new.person@channeliam.com", fullName: "New Person", team: "Creatives", jobTitle: null, role: "ADMIN", managerId: null },
    });
  });

  it("rejects missing or invalid required fields", () => {
    assert.equal(validateEmployeeInput({ fullName: "A" }).ok, false);
    assert.equal(validateEmployeeInput({ email: "not-an-email", fullName: "A" }).ok, false);
    assert.equal(validateEmployeeInput({ email: "a@b.co", fullName: "  " }).ok, false);
    assert.equal(validateEmployeeInput({ email: "a@b.co", fullName: "A", role: "OWNER" }).ok, false);
    assert.equal(validateEmployeeInput({ email: "a@b.co", fullName: "A", managerId: "x" }).ok, false);
  });
});

describe("addEmployee", () => {
  it("invites by email, then adds the membership and details", async () => {
    const { d, calls } = deps();
    assert.deepEqual(await addEmployee(d, input, { delivery: "email" }), { status: "created", userId: "u-new", delivery: "email" });
    assert.deepEqual(calls, ["find", "invite", "membership", "profile"]);
  });

  it("returns a one-time link when the invitation is not emailed", async () => {
    const { d, calls } = deps();
    const r = await addEmployee(d, input, { delivery: "link" });
    assert.equal(r.status, "created");
    assert.equal(r.status === "created" && r.delivery === "link" && r.link, "https://app/auth/confirm?token_hash=x");
    assert.ok(!calls.includes("invite"), "no email is sent");
  });

  it("does not claim success or continue when the invitation email fails", async () => {
    const { d, calls } = deps({ inviteByEmail: async () => ({ error: "Error sending invite email" }) });
    assert.deepEqual(await addEmployee(d, input, { delivery: "email" }), { status: "invite_failed", error: "Error sending invite email" });
    assert.ok(!calls.includes("membership") && !calls.includes("profile"));
  });

  it("rejects a duplicate: the account is already in the workspace", async () => {
    const { d, calls } = deps({ findAccount: async () => ({ userId: "u1", pendingInvite: false }), isMember: async () => true });
    assert.deepEqual(await addEmployee(d, input, { delivery: "email", addExisting: true }), { status: "duplicate" });
    assert.ok(!calls.includes("invite") && !calls.includes("membership"), "no second account or membership");
  });

  it("asks before adding an existing account, and never creates a second one", async () => {
    const { d, calls } = deps({ findAccount: async () => ({ userId: "u1", pendingInvite: true }) });
    assert.deepEqual(await addEmployee(d, input, { delivery: "email" }), { status: "exists", userId: "u1", pendingInvite: true });
    assert.ok(!calls.includes("invite"));
    const again = deps({ findAccount: async () => ({ userId: "u1", pendingInvite: false }) });
    assert.deepEqual(await addEmployee(again.d, input, { delivery: "email", addExisting: true }), { status: "added_existing", userId: "u1" });
    assert.ok(!again.calls.includes("invite") && again.calls.includes("membership"));
  });

  for (const existingRole of ["ADMIN", "SUPER_ADMIN"] as const) {
    it(`adds an existing ${existingRole} to another workspace without changing their role or profile`, async () => {
      // The form still holds its defaults (Individual, blank department/designation/manager).
      const blankForm: EmployeeInput = { ...input, role: "INDIVIDUAL", team: null, jobTitle: null, managerId: null };
      const profileWrites: unknown[] = [];
      const { d, calls } = deps({
        findAccount: async () => ({ userId: `u-${existingRole}`, pendingInvite: false }),
        applyProfile: async (...args) => (profileWrites.push(args), null),
      });
      assert.deepEqual(await addEmployee(d, blankForm, { delivery: "email", addExisting: true }), {
        status: "added_existing",
        userId: `u-${existingRole}`,
      });
      assert.deepEqual(calls, ["isMember", "membership"], "only the membership is added");
      assert.deepEqual(profileWrites, [], "role, name, department, designation and manager are untouched");
    });
  }

  it("re-issues an unaccepted invitation (e.g. after a failed email) as a link", async () => {
    const { d, calls } = deps({ findAccount: async () => ({ userId: "u-pending", pendingInvite: true }) });
    const r = await addEmployee(d, input, { delivery: "link", addExisting: true });
    assert.equal(r.status === "created" && r.delivery === "link" && r.link, "https://app/auth/confirm?token_hash=x");
    // findAccount is overridden above, so the fake does not record "find"; the profile is not written.
    assert.deepEqual(calls, ["isMember", "membership", "link"]);
    const failing = deps({
      findAccount: async () => ({ userId: "u-pending", pendingInvite: true }),
      inviteByEmail: async () => ({ error: "Email rate limit exceeded" }),
    });
    assert.deepEqual(await addEmployee(failing.d, input, { delivery: "email", addExisting: true }), {
      status: "partial",
      userId: "u-pending",
      done: ["Added to the workspace"],
      failed: "Invitation email: Email rate limit exceeded",
    });
  });

  it("keeps the invited account and reports what is missing when a later step fails", async () => {
    const { d } = deps({ addMembership: async () => "You don't have permission to do that." });
    assert.deepEqual(await addEmployee(d, input, { delivery: "email" }), {
      status: "partial",
      userId: "u-new",
      done: ["Account created and invitation email sent"],
      failed: "Workspace access: You don't have permission to do that.",
      link: undefined,
    });
    const p = deps({ applyProfile: async () => "Reporting lines cannot contain cycles" });
    const r = await addEmployee(p.d, input, { delivery: "link" });
    assert.equal(r.status, "partial");
    assert.equal(r.status === "partial" && r.link, "https://app/auth/confirm?token_hash=x", "the link is still shown");
  });
});

describe("inviteAcceptUrl", () => {
  it("points at the app's confirm route", () => {
    assert.equal(inviteAcceptUrl("https://tasks.example.com", "abc"), "https://tasks.example.com/auth/confirm?token_hash=abc&type=invite");
  });
});
