"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";

import { isRole, type UserRole } from "@/lib/auth/roles";
import { WORKSPACE_COOKIE } from "@/lib/data/workspace";

import { NOT_PERMITTED, cleanText, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

/** Stores the preferred workspace. Only a view preference; RLS enforces access. */
export async function switchWorkspace(workspaceId: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");

  const { data } = await actor.supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!data) return fail(NOT_PERMITTED);

  (await cookies()).set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  refresh();
  return ok();
}

export async function createWorkspace(name: string, description?: string): Promise<ActionResult<{ id: string }>> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can create workspaces.");
  const cleanName = cleanText(name, 200);
  if (!cleanName) return fail("Workspace name is required.");

  const { data, error } = await actor.supabase
    .from("workspaces")
    .insert({ name: cleanName, description: cleanText(description, 2000), created_by: actor.userId })
    .select("id")
    .single();
  if (error || !data) return fail(dbError(error, "Could not create the workspace."));

  (await cookies()).set(WORKSPACE_COOKIE, data.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  refresh();
  return ok({ id: data.id });
}

/** Super admin sets the workspace timezone (drives "today", My Day and carry-forward). */
export async function updateWorkspaceTimezone(workspaceId: string, timezone: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can change workspace settings.");
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");
  const tz = cleanText(timezone, 64);
  try {
    if (!tz) throw new Error();
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return fail("Choose a valid timezone.");
  }

  const { data, error } = await actor.supabase.from("workspaces").update({ timezone: tz }).eq("id", workspaceId).select("id");
  if (error) return fail(dbError(error));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

export type MemberUpdate = {
  fullName?: string | null;
  role?: UserRole;
  department?: string | null;
  jobTitle?: string | null;
  managerId?: string | null;
  team?: string | null;
};

/**
 * Super admin edits a member's profile (the database also enforces this).
 * Active status is not changed here: deactivation and reactivation go through
 * setEmployeeActive (src/lib/actions/employees.ts), which also blocks or
 * restores sign-in in Supabase Auth.
 */
export async function updateMemberProfile(userId: string, update: MemberUpdate): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can manage users.");
  if (!isUuid(userId)) return fail("Invalid user.");
  if (update.role !== undefined && !isRole(update.role)) return fail("Invalid role.");
  if (userId === actor.userId && update.role !== undefined) {
    return fail("You cannot change your own role.");
  }

  if (update.managerId && (!isUuid(update.managerId) || update.managerId === userId)) {
    return fail("A person cannot report to themselves.");
  }
  const patch: {
    full_name?: string | null;
    role?: UserRole;
    department?: string | null;
    job_title?: string | null;
    manager_id?: string | null;
    team?: string | null;
  } = {};
  if (update.fullName !== undefined) {
    patch.full_name = cleanText(update.fullName, 200);
    if (!patch.full_name) return fail("Full name is required.");
  }
  if (update.role !== undefined) patch.role = update.role;
  if (update.department !== undefined) patch.department = cleanText(update.department, 200);
  if (update.jobTitle !== undefined) patch.job_title = cleanText(update.jobTitle, 200);
  if (update.managerId !== undefined) patch.manager_id = update.managerId || null;
  if (update.team !== undefined) patch.team = cleanText(update.team, 100);

  const { data, error } = await actor.supabase.from("profiles").update(patch).eq("id", userId).select("id");
  if (error) return fail(dbError(error, "Could not update the user."));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

export async function setCanCreateProjects(workspaceId: string, userId: string, value: boolean): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can change this.");
  if (!isUuid(workspaceId) || !isUuid(userId)) return fail("Invalid request.");

  const { data, error } = await actor.supabase
    .from("workspace_members")
    .update({ can_create_projects: Boolean(value) })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("id");
  if (error) return fail(dbError(error));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}

export async function removeMember(workspaceId: string, userId: string): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can remove members.");
  if (!isUuid(workspaceId) || !isUuid(userId)) return fail("Invalid request.");
  if (userId === actor.userId) return fail("You cannot remove yourself.");

  const { data, error } = await actor.supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("id");
  if (error) return fail(dbError(error));
  if (!data.length) return fail(NOT_PERMITTED);
  refresh();
  return ok();
}
