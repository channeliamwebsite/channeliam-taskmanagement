import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { mayCreateProjects, type UserRole } from "@/lib/auth/roles";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";
import { loadError } from "./errors";

export const WORKSPACE_COOKIE = "tm-workspace";

export type Workspace = { id: string; name: string; description: string | null; timezone: string; isPersonal: boolean };

export type Member = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  department: string | null;
  jobTitle: string | null;
  isActive: boolean;
  canCreateProjects: boolean;
  /** Individuals only: may create clients and projects here (028, default off). */
  canCreateClientsProjects: boolean;
  /** Reporting manager (independent of task assignment). */
  managerId: string | null;
  team: string | null;
};

/**
 * Workspaces the current user belongs to (RLS-scoped). Super Admin's
 * company-wide read access would otherwise surface every Operational
 * Manager's personal workspace here; this keeps only the caller's own
 * personal workspace (if any), so they can still reach it, while every other
 * personal workspace is excluded from switchers, target pickers and
 * dashboards without any change needed at those call sites.
 */
export const getMyWorkspaces = cache(async (): Promise<Workspace[]> => {
  const supabase = await createClient();
  const currentUser = await getCurrentUser();

  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, description, timezone, is_personal, created_by")
    .order("name");

  if (error) {
    console.error("Failed to load workspaces:", error);
    throw new Error(`Failed to load workspaces: ${error.message}`);
  }

  return (data ?? [])
    .filter((w) => !w.is_personal || w.created_by === currentUser?.id)
    .map((w) => ({ id: w.id, name: w.name, description: w.description, timezone: w.timezone, isPersonal: w.is_personal }));
});

/**
 * The workspace being viewed. The cookie is only a preference; it is
 * validated against the caller's memberships and RLS still scopes every query.
 * With no (or a stale) cookie, default to a department workspace, never a
 * personal one, so the app shell doesn't silently open inside it.
 */
export const getActiveWorkspace = cache(async (): Promise<Workspace | null> => {
  const workspaces = await getMyWorkspaces();
  if (workspaces.length === 0) return null;
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const preferredWorkspace = workspaces.find((w) => w.id === preferred);
  if (preferredWorkspace) return preferredWorkspace;
  return workspaces.find((w) => !w.isPersonal) ?? workspaces[0]!;
});

export const getWorkspaceMembers = cache(async (workspaceId: string): Promise<Member[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      "user_id, can_create_projects, can_create_clients_projects, profile:profiles!workspace_members_user_id_fkey(full_name, email, avatar_url, role, department, job_title, is_active, manager_id, team)",
    )
    .eq("workspace_id", workspaceId);
  if (error) throw loadError("Failed to load workspace members", error);

  return data
    .filter((row) => row.profile)
    .map((row) => ({
      userId: row.user_id,
      fullName: row.profile!.full_name,
      email: row.profile!.email,
      avatarUrl: row.profile!.avatar_url,
      role: row.profile!.role,
      department: row.profile!.department,
      jobTitle: row.profile!.job_title,
      isActive: row.profile!.is_active,
      canCreateProjects: row.can_create_projects,
      canCreateClientsProjects: row.can_create_clients_projects,
      managerId: row.profile!.manager_id,
      team: row.profile!.team,
    }))
    .sort((a, b) => (a.fullName || a.email || "").localeCompare(b.fullName || b.email || ""));
});

/**
 * Whether the current user may create projects in the workspace (mirrors
 * RLS). Super Admin is monitoring-only as of Phase 2 (044/046): no branch
 * here, same as the database. Operational Manager's branch inside
 * mayCreateProjects is unconditional, matching private.can_create_project.
 */
export async function canCreateProjects(workspaceId: string, userId: string, role: UserRole) {
  const members = await getWorkspaceMembers(workspaceId);
  return mayCreateProjects(role, members.find((m) => m.userId === userId) ?? null);
}

/** Today's date in the workspace timezone (defaults to India). */
export function workspaceToday(workspace: Pick<Workspace, "timezone"> | null) {
  return todayISO(new Date(), workspace?.timezone || BUSINESS_TIMEZONE);
}
