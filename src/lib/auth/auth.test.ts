import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getPermissions, hasMinimumRole, hasRole, isRole, ROUTE_ROLES } from "./roles.ts";
import { DEFAULT_AUTHENTICATED_ROUTE, isPublicRoute, requiresAuth, safeRedirectPath } from "./routes.ts";
import { validateLogin } from "./validation.ts";

describe("route protection", () => {
  it("only /login is public; everything else requires a session (deny by default)", () => {
    assert.equal(isPublicRoute("/login"), true);
    for (const path of ["/", "/my-day", "/tasks", "/tasks/abc", "/team", "/settings", "/inbox", "/unknown"]) {
      assert.equal(requiresAuth(path), true, path);
    }
    assert.equal(requiresAuth("/auth/signout"), false);
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

  it("grants task creation/assignment to admins and above only", () => {
    assert.equal(getPermissions("INDIVIDUAL").createTasks, false);
    assert.equal(getPermissions("INDIVIDUAL").assignTasks, false);
    assert.equal(getPermissions("ADMIN").assignTasks, true);
    assert.equal(getPermissions("SUPER_ADMIN").assignTasks, true);
  });

  it("reserves user management and settings for super admins", () => {
    assert.equal(getPermissions("ADMIN").manageUsers, false);
    assert.equal(getPermissions("ADMIN").manageSystemSettings, false);
    assert.equal(getPermissions("SUPER_ADMIN").manageUsers, true);
  });

  it("restricts /team to admins and above", () => {
    assert.equal(hasRole("INDIVIDUAL", ROUTE_ROLES["/team"]!), false);
    assert.equal(hasRole("ADMIN", ROUTE_ROLES["/team"]!), true);
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
