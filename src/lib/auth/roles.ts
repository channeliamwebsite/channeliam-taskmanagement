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
    // Super admins monitor and compare reports; they do not submit their own.
    submitDailyReports: !isSuperAdmin,
  } as const;
}

export type Permissions = ReturnType<typeof getPermissions>;

/**
 * Whether a user may edit a project, mirroring the projects update policy
 * (migration 020): super admins; admins who own or created it; and admins who
 * may create projects in that workspace, for any project but the General one.
 * `mayCreate` is mayCreateProjects for the project's workspace.
 */
export function mayEditProject(
  role: UserRole,
  userId: string,
  project: { ownerId: string | null; createdBy: string | null; isDefault: boolean },
  mayCreate: boolean,
) {
  if (role === "SUPER_ADMIN") return true;
  if (role !== "ADMIN") return false;
  return project.ownerId === userId || project.createdBy === userId || (mayCreate && !project.isDefault);
}

/**
 * Whether a user may create projects in a workspace, mirroring
 * `private.can_create_project`: a super admin in any workspace (company-level
 * since 025), an admin whose membership has `can_create_projects`, or an
 * individual granted `can_create_clients_projects` (028, default off).
 * `membership` is the user's own row in that workspace, or null when they are
 * not a member.
 */
export function mayCreateProjects(
  role: UserRole,
  membership: { canCreateProjects: boolean; canCreateClientsProjects?: boolean } | null,
) {
  if (role === "SUPER_ADMIN") return true;
  if (!membership) return false;
  if (role === "INDIVIDUAL") return Boolean(membership.canCreateClientsProjects);
  return role === "ADMIN" && membership.canCreateProjects;
}

/**
 * Whether a user may create clients in a workspace, mirroring the clients
 * insert policies: super admins anywhere, admins of the workspace, and
 * individuals granted `can_create_clients_projects` (028).
 */
export function mayCreateClients(
  role: UserRole,
  membership: { canCreateClientsProjects?: boolean } | null,
) {
  if (role === "SUPER_ADMIN") return true;
  if (!membership) return false;
  return role === "ADMIN" || Boolean(membership.canCreateClientsProjects);
}
export type Permission = keyof Permissions;

/**
 * Minimum role per protected area. Routes not listed are open to every
 * signed-in, active user. Enforced in server components via `requireRole`.
 */
export const ROUTE_ROLES: Record<string, readonly UserRole[]> = {
  "/team": ["SUPER_ADMIN", "ADMIN"],
  "/team-today": ["SUPER_ADMIN", "ADMIN"],
  // Attendance & HR administration: super admins only (034, decided 2026-11-03).
  "/hr": ["SUPER_ADMIN"],
};
