// Role model shared by server and client code. These helpers drive UI and
// route decisions only; the database (RLS + triggers) remains the source of
// truth for what a user can actually read or change.

import type { Database } from "@/types/database";

export type UserRole = Database["public"]["Enums"]["user_role"];

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  INDIVIDUAL: "INDIVIDUAL",
} as const satisfies Record<UserRole, UserRole>;

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  INDIVIDUAL: "Individual",
};

const ROLE_RANK: Record<UserRole, number> = {
  INDIVIDUAL: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && value in ROLE_RANK;
}

export function hasRole(role: UserRole, allowed: readonly UserRole[]) {
  return allowed.includes(role);
}

/** True when `role` is at least as privileged as `minimum`. */
export function hasMinimumRole(role: UserRole, minimum: UserRole) {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Capability flags derived from the role model agreed for the system. */
export function getPermissions(role: UserRole) {
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isAdminOrAbove = hasMinimumRole(role, "ADMIN");

  return {
    manageUsers: isSuperAdmin,
    manageSystemSettings: isSuperAdmin,
    viewAllReports: isSuperAdmin,
    viewOrganizationActivity: isSuperAdmin,
    createWorkspaces: isSuperAdmin,
    // Everyone may create tasks for themselves; assigning work to other
    // people is a separate, admin-and-above permission (also enforced in RLS).
    createTasks: true,
    assignTasks: isAdminOrAbove,
    viewTeam: isAdminOrAbove,
    viewTeamReports: isAdminOrAbove,
    // Projects: admins additionally need the per-workspace
    // `can_create_projects` flag, which the database enforces.
    createProjects: isAdminOrAbove,
    updateTaskStatus: true,
    comment: true,
    uploadAttachments: true,
    trackTime: true,
    submitDailyReports: true,
  } as const;
}

export type Permissions = ReturnType<typeof getPermissions>;
export type Permission = keyof Permissions;

/**
 * Minimum role per protected area. Routes not listed are open to every
 * signed-in, active user. Enforced in server components via `requireRole`.
 */
export const ROUTE_ROLES: Record<string, readonly UserRole[]> = {
  "/team": ["SUPER_ADMIN", "ADMIN"],
  "/team-today": ["SUPER_ADMIN", "ADMIN"],
};
