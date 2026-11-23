// Role model shared by server and client code. These helpers drive UI and
// route decisions only; the database (RLS + triggers) remains the source of
// truth for what a user can actually read or change.

import type { Database } from "@/types/database";

export type UserRole = Database["public"]["Enums"]["user_role"];

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  OPERATIONAL_MANAGER: "OPERATIONAL_MANAGER",
  ADMIN: "ADMIN",
  INDIVIDUAL: "INDIVIDUAL",
} as const satisfies Record<UserRole, UserRole>;

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  OPERATIONAL_MANAGER: "Operational Manager",
  ADMIN: "Admin",
  INDIVIDUAL: "Individual",
};

// Operational Manager sits above Individual but is intentionally NOT >= Admin:
// it has company-wide task powers, not Admin's organisation-structure/team
// administration. Code that needs the latter checks the role directly.
const ROLE_RANK: Record<UserRole, number> = {
  INDIVIDUAL: 1,
  OPERATIONAL_MANAGER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
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

/**
 * Capability flags derived from the role model agreed for the system.
 *
 * Phase 2 (personal workspaces): Super Admin is monitoring-only — no task or
 * project creation, assignment, editing, deletion, personal tasks, or task
 * moderation (mirrors migrations 044-046). Operational Manager gets
 * company-wide task creation/assignment and project creation (across
 * departments and in their own personal workspace) without the
 * organisation-structure administration that Admin has (viewTeam etc.).
 */
export function getPermissions(role: UserRole) {
  const isSuperAdmin = role === "SUPER_ADMIN";
  const isAdmin = role === "ADMIN";
  const isOperationalManager = role === "OPERATIONAL_MANAGER";
  const managesWork = isAdmin || isOperationalManager;

  return {
    manageUsers: isSuperAdmin,
    manageSystemSettings: isSuperAdmin,
    viewAllReports: isSuperAdmin,
    viewOrganizationActivity: isSuperAdmin,
    createWorkspaces: isSuperAdmin,
    createTasks: !isSuperAdmin,
    assignTasks: managesWork,
    // /team (employee administration) stays Admin+Super Admin only --
    // organisation-structure rights Operational Manager is deliberately
    // excluded from. viewTeamReports (Daily Updates) is company-wide
    // monitoring, not organisation-structure, so Operational Manager gets it
    // too -- same read scope as its task/project/client access.
    viewTeam: isAdmin || isSuperAdmin,
    viewTeamReports: isAdmin || isSuperAdmin || isOperationalManager,
    // Projects: admins additionally need the per-workspace
    // `can_create_projects` flag, which the database enforces. Operational
    // Manager's project creation is unrestricted at the database layer.
    createProjects: managesWork,
    updateTaskStatus: !isSuperAdmin,
    comment: true,
    uploadAttachments: true,
    trackTime: !isSuperAdmin,
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
  // Super Admin is monitoring-only as of Phase 2 (046): no project edit rights.
  if (role !== "ADMIN") return false;
  return project.ownerId === userId || project.createdBy === userId || (mayCreate && !project.isDefault);
}

/**
 * Whether a user may create projects in a workspace, mirroring
 * `private.can_create_project`: an operational manager in any workspace
 * (044, unrestricted), an admin whose membership has `can_create_projects`,
 * or an individual granted `can_create_clients_projects` (028, default off).
 * Super Admin has no branch here as of 044 (monitoring-only).
 * `membership` is the user's own row in that workspace, or null when they are
 * not a member.
 */
export function mayCreateProjects(
  role: UserRole,
  membership: { canCreateProjects: boolean; canCreateClientsProjects?: boolean } | null,
) {
  // Super Admin is monitoring-only as of Phase 2 (044): no project creation.
  // Operational Manager may create a project in any workspace, personal or
  // department, with no membership requirement (private.can_create_project).
  if (role === "OPERATIONAL_MANAGER") return true;
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
  // Client reports (038): super admins and the client's workspace admins.
  "/client-reports": ["SUPER_ADMIN", "ADMIN"],
};
