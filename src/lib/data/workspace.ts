import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/roles";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";
import { loadError } from "./errors";

export const WORKSPACE_COOKIE = "tm-workspace";

export type Workspace = { id: string; name: string; description: string | null; timezone: string };

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
  /** Reporting manager (independent of task assignment). */
  managerId: string | null;
  team: string | null;
};

/** Workspaces the current user belongs to (RLS-scoped). */

export const getMyWorkspaces = cache(async (): Promise<Workspace[]> => {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, description, timezone")
    .order("name");

  if (error) {
    console.error("Failed to load workspaces:", error);
    throw new Error(`Failed to load workspaces: ${error.message}`);
  }

  return data ?? [];
});



/**
 * The workspace being viewed. The cookie is only a preference; it is
 * validated against the caller's memberships and RLS still scopes every query.
 */
export const getActiveWorkspace = cache(async (): Promise<Workspace | null> => {
  const workspaces = await getMyWorkspaces();
  if (workspaces.length === 0) return null;
  const preferred = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  return workspaces.find((w) => w.id === preferred) ?? workspaces[0]!;
});

export const getWorkspaceMembers = cache(async (workspaceId: string): Promise<Member[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select(
      "user_id, can_create_projects, profile:profiles!workspace_members_user_id_fkey(full_name, email, avatar_url, role, department, job_title, is_active, manager_id, team)",
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
      managerId: row.profile!.manager_id,
      team: row.profile!.team,
    }))
    .sort((a, b) => (a.fullName || a.email || "").localeCompare(b.fullName || b.email || ""));
});

/** Whether the current user may create projects in the workspace (mirrors RLS). */
export async function canCreateProjects(workspaceId: string, userId: string, role: UserRole) {
  if (role === "SUPER_ADMIN") return true;
  if (role !== "ADMIN") return false;
  const members = await getWorkspaceMembers(workspaceId);
  return members.some((m) => m.userId === userId && m.canCreateProjects);
}

/** Today's date in the workspace timezone (defaults to India). */
export function workspaceToday(workspace: Pick<Workspace, "timezone"> | null) {
  return todayISO(new Date(), workspace?.timezone || BUSINESS_TIMEZONE);
}
