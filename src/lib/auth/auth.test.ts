import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getPermissions, hasMinimumRole, hasRole, isRole, mayCreateClients, mayCreateProjects, mayEditProject, ROUTE_ROLES } from "./roles.ts";
import { DEFAULT_AUTHENTICATED_ROUTE, authLinkRedirect, isPublicRoute, requiresAuth, safeRedirectPath } from "./routes.ts";
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
  it("recognises only the four defined roles", () => {
    assert.equal(isRole("SUPER_ADMIN"), true);
    assert.equal(isRole("OPERATIONAL_MANAGER"), true);
    assert.equal(isRole("OWNER"), false);
    assert.equal(isRole("admin"), false);
  });

  it("orders roles SUPER_ADMIN > ADMIN > OPERATIONAL_MANAGER > INDIVIDUAL", () => {
    assert.equal(hasMinimumRole("SUPER_ADMIN", "ADMIN"), true);
    assert.equal(hasMinimumRole("ADMIN", "SUPER_ADMIN"), false);
    assert.equal(hasMinimumRole("INDIVIDUAL", "ADMIN"), false);
    // Operational Manager is deliberately NOT >= Admin: it has company-wide
    // task powers, not Admin's organisation-structure administration.
    assert.equal(hasMinimumRole("OPERATIONAL_MANAGER", "ADMIN"), false);
    assert.equal(hasMinimumRole("OPERATIONAL_MANAGER", "INDIVIDUAL"), true);
  });

  it("Phase 2: Super Admin is monitoring-only - no task creation or assignment, personal tasks included", () => {
    assert.equal(getPermissions("INDIVIDUAL").createTasks, true);
    assert.equal(getPermissions("INDIVIDUAL").assignTasks, false);
    assert.equal(getPermissions("ADMIN").assignTasks, true);
    assert.equal(getPermissions("SUPER_ADMIN").createTasks, false);
    assert.equal(getPermissions("SUPER_ADMIN").assignTasks, false);
    // Operational Manager creates and assigns tasks company-wide.
    assert.equal(getPermissions("OPERATIONAL_MANAGER").createTasks, true);
    assert.equal(getPermissions("OPERATIONAL_MANAGER").assignTasks, true);
    assert.equal(getPermissions("OPERATIONAL_MANAGER").createProjects, true);
    // Not Admin's organisation-structure administration (/team stays Admin+Super Admin only).
    assert.equal(getPermissions("OPERATIONAL_MANAGER").viewTeam, false);
    // Daily Updates (company-wide monitoring, not organisation-structure) is granted.
    assert.equal(getPermissions("OPERATIONAL_MANAGER").viewTeamReports, true);
  });

  it("lets admins and individuals submit daily reports; super admins only review them", () => {
    assert.equal(getPermissions("INDIVIDUAL").submitDailyReports, true);
    assert.equal(getPermissions("ADMIN").submitDailyReports, true);
    assert.equal(getPermissions("OPERATIONAL_MANAGER").submitDailyReports, true);
    assert.equal(getPermissions("SUPER_ADMIN").submitDailyReports, false);
    assert.equal(getPermissions("SUPER_ADMIN").viewTeamReports, true);
  });

  it("reserves user management and settings for super admins", () => {
    assert.equal(getPermissions("ADMIN").manageUsers, false);
    assert.equal(getPermissions("ADMIN").manageSystemSettings, false);
    assert.equal(getPermissions("SUPER_ADMIN").manageUsers, true);
  });

  it("lets permitted admins and operational managers create projects; super admin cannot (044/046)", () => {
    const allowed = { canCreateProjects: true };
    const notAllowed = { canCreateProjects: false };
    assert.equal(mayCreateProjects("SUPER_ADMIN", notAllowed), false);
    assert.equal(mayCreateProjects("ADMIN", allowed), true);
    assert.equal(mayCreateProjects("ADMIN", notAllowed), false);
    assert.equal(mayCreateProjects("INDIVIDUAL", allowed), false);
    // Operational Manager is unrestricted by membership (private.can_create_project).
    assert.equal(mayCreateProjects("OPERATIONAL_MANAGER", null), true);
    assert.equal(mayCreateProjects("OPERATIONAL_MANAGER", notAllowed), true);
    // Not a member of the workspace: refused for admins, as in RLS; super
    // admin has no branch here as of 044.
    assert.equal(mayCreateProjects("SUPER_ADMIN", null), false);
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

  it("lets owners/creators and project-managing admins edit projects; super admin cannot (046)", () => {
    const bySa = { ownerId: null, createdBy: "sa", isDefault: false };
    assert.equal(mayEditProject("SUPER_ADMIN", "sa2", bySa, false), false);
    assert.equal(mayEditProject("ADMIN", "ad", bySa, true), true, "a super admin's project, admin may manage projects");
    assert.equal(mayEditProject("ADMIN", "ad", bySa, false), false, "restricted admin, not owner");
    assert.equal(mayEditProject("ADMIN", "ad", { ...bySa, ownerId: "ad" }, false), true, "restricted admin who owns it");
    assert.equal(mayEditProject("ADMIN", "ad", { ...bySa, isDefault: true }, true), false, "the General project");
    assert.equal(mayEditProject("INDIVIDUAL", "iv", { ...bySa, ownerId: "iv", createdBy: "iv" }, true), false);
  });

  it("restricts /team to admins and above, deliberately excluding operational managers", () => {
    assert.equal(hasRole("INDIVIDUAL", ROUTE_ROLES["/team"]!), false);
    assert.equal(hasRole("ADMIN", ROUTE_ROLES["/team"]!), true);
    assert.equal(hasRole("OPERATIONAL_MANAGER", ROUTE_ROLES["/team"]!), false);
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

describe("authLinkRedirect (Site URL fallback)", () => {
  it("sends a recovery code on / to /auth/confirm with the query", () => {
    assert.equal(authLinkRedirect("/", "?code=abc"), "/auth/confirm?code=abc");
  });
  it("keeps token hash and type", () => {
    assert.equal(authLinkRedirect("/", "?token_hash=t&type=recovery"), "/auth/confirm?token_hash=t&type=recovery");
  });
  it("forwards Supabase errors from /login", () => {
    assert.equal(authLinkRedirect("/login", "?error=access_denied&error_code=otp_expired"), "/auth/confirm?error=access_denied&error_code=otp_expired");
  });
  it("ignores ordinary pages and queries", () => {
    assert.equal(authLinkRedirect("/", ""), null);
    assert.equal(authLinkRedirect("/login", "?next=%2Ftasks"), null);
    assert.equal(authLinkRedirect("/tasks", "?code=abc"), null);
  });
});
