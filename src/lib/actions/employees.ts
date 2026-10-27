"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { addEmployee, inviteAcceptUrl, validateEmployeeInput, type AddEmployeeResult, type Delivery, type EmployeeInput } from "@/lib/employee-workflow";
import { createAdminClient } from "@/lib/supabase/admin";

import { NOT_PERMITTED, dbError, fail, getActor, isUuid, ok, type ActionResult } from "./shared";

// Employee management for super admins. Supabase Auth admin calls (create /
// invite / block sign-in) need the service-role client, which never leaves the
// server. Memberships and profile fields are written with the super admin's
// own client, so RLS and the profile guard trigger check every change.

/** Ban length used to block sign-in for deactivated employees (≈100 years). */
const BLOCKED = "876000h";

async function superAdmin() {
  const actor = await getActor();
  if (!actor.ok) return actor;
  if (actor.profile.role !== "SUPER_ADMIN") return fail("Only a super admin can manage employees.");
  return actor;
}

function adminClient() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : null;
}

const NO_SERVICE_KEY = "Employee accounts can only be managed when SUPABASE_SERVICE_ROLE_KEY is configured on the server.";

async function appOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

/** Auth errors are shown as Supabase reports them; they carry no secrets. */
function authError(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

export type AddEmployeeRequest = Partial<Record<keyof EmployeeInput, unknown>> & {
  workspaceId: string;
  delivery: Delivery;
  addExisting?: boolean;
};

export async function createEmployee(request: AddEmployeeRequest): Promise<ActionResult<AddEmployeeResult>> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  const { workspaceId, delivery, addExisting } = request;
  if (!isUuid(workspaceId)) return fail("Invalid workspace.");
  if (delivery !== "email" && delivery !== "link") return fail("Choose how to send the invitation.");
  const parsed = validateEmployeeInput(request);
  if (!parsed.ok) return fail(parsed.error);
  const input = parsed.value;

  // RLS: only visible if the caller is a member; adding members also requires super admin rights there.
  const { data: workspace } = await actor.supabase.from("workspaces").select("id").eq("id", workspaceId).maybeSingle();
  if (!workspace) return fail(NOT_PERMITTED);
  if (input.managerId) {
    const { data: manager } = await actor.supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", input.managerId)
      .maybeSingle();
    if (!manager) return fail("The reporting manager must be a member of this workspace.");
  }

  const admin = adminClient();
  if (!admin) return fail(NO_SERVICE_KEY);
  const origin = await appOrigin();

  const result = await addEmployee(
    {
      async findAccount(email) {
        const { data } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
        if (!data) return null;
        const { data: auth } = await admin.auth.admin.getUserById(data.id);
        const u = auth.user;
        return { userId: data.id, pendingInvite: Boolean(u && !u.email_confirmed_at && !u.last_sign_in_at) };
      },
      async isMember(userId) {
        const { data } = await actor.supabase
          .from("workspace_members")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .maybeSingle();
        return Boolean(data);
      },
      async inviteByEmail(email, fullName) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: fullName },
          redirectTo: `${origin}/auth/confirm`,
        });
        if (error || !data.user) return { error: authError(error, "The invitation email could not be sent.") };
        return { userId: data.user.id };
      },
      async createInviteLink(email, fullName) {
        const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: fullName } } });
        if (error || !data.user || !data.properties?.hashed_token) return { error: authError(error, "The invite link could not be created.") };
        return { userId: data.user.id, link: inviteAcceptUrl(origin, data.properties.hashed_token) };
      },
      async addMembership(userId) {
        const { error } = await actor.supabase
          .from("workspace_members")
          .insert({ workspace_id: workspaceId, user_id: userId, can_create_projects: false });
        return error && error.code !== "23505" ? dbError(error) : null;
      },
      async applyProfile(userId, value) {
        const { data, error } = await actor.supabase
          .from("profiles")
          .update({
            full_name: value.fullName,
            team: value.team,
            job_title: value.jobTitle,
            manager_id: value.managerId === userId ? null : value.managerId,
            ...(userId === actor.userId ? {} : { role: value.role }),
          })
          .eq("id", userId)
          .select("id");
        if (error) return dbError(error);
        return data.length ? null : "You don't have permission to do that.";
      },
    },
    input,
    { delivery, addExisting },
  );

  if (result.status !== "invite_failed" && result.status !== "duplicate" && result.status !== "exists") refresh();
  return ok(result);
}

/** Re-sends (email) or re-creates (link) the invitation for someone who has not accepted it yet. */
export async function reissueInvite(workspaceId: string, userId: string, delivery: Delivery): Promise<ActionResult<{ link?: string }>> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) return fail("Invalid request.");
  if (delivery !== "email" && delivery !== "link") return fail("Choose how to send the invitation.");

  // Only for members of a workspace the caller can see (RLS).
  const { data: member } = await actor.supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return fail(NOT_PERMITTED);

  const admin = adminClient();
  if (!admin) return fail(NO_SERVICE_KEY);
  const { data: auth, error: lookupError } = await admin.auth.admin.getUserById(userId);
  const user = auth.user;
  if (lookupError || !user?.email) return fail("Could not find that account.");
  if (user.email_confirmed_at || user.last_sign_in_at) return fail("This employee has already accepted the invitation.");

  if (delivery === "email") {
    const { error } = await admin.auth.admin.inviteUserByEmail(user.email, { redirectTo: `${await appOrigin()}/auth/confirm` });
    if (error) return fail(`The invitation email could not be sent: ${authError(error, "unknown error")}`);
    return ok({});
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email: user.email });
  if (error || !data.properties?.hashed_token) return fail(`The invite link could not be created: ${authError(error, "unknown error")}`);
  return ok({ link: inviteAcceptUrl(await appOrigin(), data.properties.hashed_token) });
}

/**
 * The only path that changes an employee's active status (Edit employee does
 * not). Nothing is deleted: tasks, reports and memberships are kept.
 *
 * Deactivate: the profile first — that is what the database enforces
 * (inactive users fail every RLS check) — then the Supabase Auth sign-in
 * block, so existing sessions cannot be refreshed. If the block cannot be
 * applied the employee stays deactivated (still no access) and a warning says so.
 *
 * Reactivate: lift the sign-in block first, then activate the profile, so an
 * employee is never left active but unable to sign in. If the block cannot be
 * lifted nothing changes; if activation then fails, the block is restored.
 */
export async function setEmployeeActive(userId: string, active: boolean): Promise<ActionResult<{ warning?: string }>> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(userId)) return fail("Invalid user.");
  if (userId === actor.userId) return fail("You cannot deactivate yourself.");
  const admin = adminClient();

  if (!active) {
    const { data, error } = await actor.supabase.from("profiles").update({ is_active: false }).eq("id", userId).select("id");
    if (error) return fail(dbError(error, "Could not update the employee."));
    if (!data.length) return fail(NOT_PERMITTED);
    refresh();
    if (!admin) return ok({ warning: "Deactivated, but sign-in could not be blocked: SUPABASE_SERVICE_ROLE_KEY is not configured." });
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BLOCKED });
    if (banError) return ok({ warning: `Deactivated, but sign-in could not be blocked: ${authError(banError, "unknown error")}` });
    return ok({});
  }

  // A super admin can see (RLS) exactly the profiles they may update: members
  // of their workspaces. Checked before touching Supabase Auth.
  const { data: target } = await actor.supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!target) return fail(NOT_PERMITTED);
  if (!admin) return fail(`Reactivation needs SUPABASE_SERVICE_ROLE_KEY on the server to restore sign-in. ${NO_SERVICE_KEY}`);
  const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (unbanError) return fail(`Sign-in could not be restored, so nothing was changed: ${authError(unbanError, "unknown error")}`);

  const { data, error } = await actor.supabase.from("profiles").update({ is_active: true }).eq("id", userId).select("id");
  if (error || !data.length) {
    const { error: rebanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BLOCKED });
    const reason = error ? dbError(error, "Could not update the employee.") : NOT_PERMITTED;
    return fail(rebanError ? `${reason} Sign-in was restored but the employee is still inactive, so they still have no access.` : reason);
  }
  refresh();
  return ok({});
}

/** Adds or removes an employee's membership of a workspace the caller super-administers (RLS-checked). */
export async function setWorkspaceAccess(workspaceId: string, userId: string, member: boolean): Promise<ActionResult> {
  const actor = await superAdmin();
  if (!actor.ok) return actor;
  if (!isUuid(workspaceId) || !isUuid(userId)) return fail("Invalid request.");
  if (!member && userId === actor.userId) return fail("You cannot remove yourself.");

  if (member) {
    const { error } = await actor.supabase.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, can_create_projects: false });
    if (error && error.code !== "23505") return fail(dbError(error));
  } else {
    const { data, error } = await actor.supabase.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId).select("id");
    if (error) return fail(dbError(error));
    if (!data.length) return fail(NOT_PERMITTED);
  }
  refresh();
  return ok();
}
