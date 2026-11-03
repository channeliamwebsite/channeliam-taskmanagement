import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getPermissions, hasMinimumRole, hasRole, isRole, mayCreateClients, mayCreateProjects, mayEditProject, ROUTE_ROLES } from "./roles.ts";
import { DEFAULT_AUTHENTICATED_ROUTE, isPublicRoute, requiresAuth, safeRedirectPath } from "./routes.ts";
import { validateLogin, validateNewPassword } from "./validation.ts";

describe("route protection", () => {
  it("only /login is public; everything else requires a session (deny by default)", () => {
    assert.equal(isPublicRoute("/login"), true);
    for (const path of ["/", "/my-day", "/tasks", "/tasks/abc", "/team", "/settings", "/inbox", "/unknown"]) {
      assert.equal(requiresAuth(path), true, path);
    }
    assert.equal(requiresAuth("/auth/signout"), false);
    assert.equal(requiresAuth("/auth/confirm"), false, "invitation links work without a session");
    assert.equal(requiresAuth("/auth/set-password"), true, "setting a password needs the invitation's session");
  });

  it("validates a new password", () => {
    assert.match(validateNewPassword("short", "short") ?? "", /at least 8/);
    assert.match(validateNewPassword("long enough", "different") ?? "", /do not match/);
    assert.equal(validateNewPassword("long enough", "long enough"), null);
  });

  it("blocks open redirects in ?next=", () => {
    assert.equal(safeRedirectPath("/tasks?x=1"), "/tasks?x=1");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "", null, undefined, "/login"]) {
      assert.equal(safeRedirectPath(bad as string), DEFAULT_AUTHENTICATED_ROUTE, String(bad));
    }
  });
});

describe("roles and permissions", () => {
  it("recognises only the three defined roles", () => {
    assert.equal(isRole("SUPER_ADMIN"), true);
    assert.equal(isRole("OWNER"), false);
    assert.equal(isRole("admin"), false);
  });

  it("orders roles SUPER_ADMIN > ADMIN > INDIVIDUAL", () => {
    assert.equal(hasMinimumRole("SUPER_ADMIN", "ADMIN"), true);
    assert.equal(hasMinimumRole("ADMIN", "SUPER_ADMIN"), false);
    assert.equal(hasMinimumRole("INDIVIDUAL", "ADMIN"), false);
  });

  it("lets everyone create tasks but only admins and above assign them", () => {
    assert.equal(getPermissions("INDIVIDUAL").createTasks, true);
    assert.equal(getPermissions("INDIVIDUAL").assignTasks, false);
    assert.equal(getPermissions("ADMIN").assignTasks, true);
    assert.equal(getPermissions("SUPER_ADMIN").assignTasks, true);
  });

  it("lets admins and individuals submit daily reports; super admins only review them", () => {
    assert.equal(getPermissions("INDIVIDUAL").submitDailyReports, true);
    assert.equal(getPermissions("ADMIN").submitDailyReports, true);
    assert.equal(getPermissions("SUPER_ADMIN").submitDailyReports, false);
    assert.equal(getPermissions("SUPER_ADMIN").viewTeamReports, true);
  });

  it("reserves user management and settings for super admins", () => {
    assert.equal(getPermissions("ADMIN").manageUsers, false);
    assert.equal(getPermissions("ADMIN").manageSystemSettings, false);
    assert.equal(getPermissions("SUPER_ADMIN").manageUsers, true);
  });

  it("lets super admins and permitted admins create projects in their own workspaces only", () => {
    const allowed = { canCreateProjects: true };
    const notAllowed = { canCreateProjects: false };
    assert.equal(mayCreateProjects("SUPER_ADMIN", notAllowed), true);
    assert.equal(mayCreateProjects("ADMIN", allowed), true);
    assert.equal(mayCreateProjects("ADMIN", notAllowed), false);
    assert.equal(mayCreateProjects("INDIVIDUAL", allowed), false);
    // Not a member of the workspace: refused for admins, as in RLS; super
    // admins are company-level since migration 025.
    assert.equal(mayCreateProjects("SUPER_ADMIN", null), true);
    assert.equal(mayCreateProjects("ADMIN", null), false);
    assert.equal(mayCreateProjects("INDIVIDUAL", null), false);
  });

  it("lets individuals create clients and projects only with the default-off grant (028)", () => {
    const member = { canCreateProjects: true, canCreateClientsProjects: false };
    const granted = { canCreateProjects: false, canCreateClientsProjects: true };
    // can_create_projects (default true since 020) gives individuals nothing.
    assert.equal(mayCreateProjects("INDIVIDUAL", member), false);
    assert.equal(mayCreateClients("INDIVIDUAL", member), false);
    assert.equal(mayCreateProjects("INDIVIDUAL", granted), true);
    assert.equal(mayCreateClients("INDIVIDUAL", granted), true);
    assert.equal(mayCreateClients("INDIVIDUAL", null), false);
    // The individual grant does not change admins' project rule.
    assert.equal(mayCreateProjects("ADMIN", granted), false);
    assert.equal(mayCreateClients("ADMIN", { canCreateClientsProjects: false }), true);
    assert.equal(mayCreateClients("ADMIN", null), false);
    assert.equal(mayCreateClients("SUPER_ADMIN", null), true);
  });

  it("lets super admins, owners/creators and project-managing admins edit projects", () => {
    const bySa = { ownerId: null, createdBy: "sa", isDefault: false };
    assert.equal(mayEditProject("SUPER_ADMIN", "sa2", bySa, false), true);
    assert.equal(mayEditProject("ADMIN", "ad", bySa, true), true, "a super admin's project, admin may manage projects");
    assert.equal(mayEditProject("ADMIN", "ad", bySa, false), false, "restricted admin, not owner");
    assert.equal(mayEditProject("ADMIN", "ad", { ...bySa, ownerId: "ad" }, false), true, "restricted admin who owns it");
    assert.equal(mayEditProject("ADMIN", "ad", { ...bySa, isDefault: true }, true), false, "the General project");
    assert.equal(mayEditProject("INDIVIDUAL", "iv", { ...bySa, ownerId: "iv", createdBy: "iv" }, true), false);
  });

  it("restricts /team to admins and above", () => {
    assert.equal(hasRole("INDIVIDUAL", ROUTE_ROLES["/team"]!), false);
    assert.equal(hasRole("ADMIN", ROUTE_ROLES["/team"]!), true);
  });

  it("restricts the HR dashboard and company-wide HR pages to super admins", () => {
    assert.equal(hasRole("SUPER_ADMIN", ROUTE_ROLES["/hr"]!), true);
    assert.equal(hasRole("ADMIN", ROUTE_ROLES["/hr"]!), false);
    assert.equal(hasRole("INDIVIDUAL", ROUTE_ROLES["/hr"]!), false);
  });
});

describe("login validation", () => {
  it("accepts a valid email and password", () => {
    assert.deepEqual(validateLogin("person@agency.example", "secret12"), {});
  });

  it("rejects missing or malformed input", () => {
    assert.ok(validateLogin("", "secret12").email);
    assert.ok(validateLogin("not-an-email", "secret12").email);
    assert.ok(validateLogin("person@agency.example", "").password);
    assert.ok(validateLogin("person@agency.example", "12345").password);
    assert.ok(validateLogin("person@agency.example", "x".repeat(73)).password);
  });
});
