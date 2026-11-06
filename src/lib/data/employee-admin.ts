import "server-only";

import type { EmployeeMember, ManagerOption, WorkspaceOption } from "@/components/team/member-controls";
import { TEAM_OPTIONS, displayName } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";

import { getAccountStatuses } from "./employees";
import { loadError } from "./errors";
import { getMyWorkspaces } from "./workspace";

/**
 * Active Super Admins, company-wide. Super Admin is a company role without
 * workspace membership, so workspace member lists never include them; reporting-
 * manager pickers add them from here. RLS returns rows to super admins only.
 */
export async function listActiveSuperAdmins(): Promise<ManagerOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name, email, job_title").eq("role", "SUPER_ADMIN").eq("is_active", true);
  if (error) throw loadError("Failed to load super admins", error);
  return (data ?? [])
    .map((p) => ({ userId: p.id, name: `${displayName({ full_name: p.full_name, email: p.email })} · ${p.job_title?.trim() || "Super Admin"}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What /hr/employees/[id] needs for the Employment and Account sections (super
 * admins; RLS lets them read every profile and membership). Null when the
 * profile is not visible.
 */
export async function getEmployeeAdmin(userId: string): Promise<{
  member: EmployeeMember;
  managers: ManagerOption[];
  departments: string[];
  workspaces: (WorkspaceOption & { member: boolean })[];
  /** A workspace the employee belongs to, for the invite / reset actions. */
  memberWorkspaceId: string | null;
} | null> {
  const supabase = await createClient();
  const [profileRes, peopleRes, membershipRes, workspaces, statuses] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, role, team, job_title, manager_id, is_active").eq("id", userId).maybeSingle(),
    supabase.from("profiles").select("id, full_name, email, role, team, is_active"),
    supabase.from("workspace_members").select("workspace_id").eq("user_id", userId),
    getMyWorkspaces(),
    getAccountStatuses([userId]),
  ]);
  if (profileRes.error) throw loadError("Failed to load the employee", profileRes.error);
  if (peopleRes.error) throw loadError("Failed to load employees", peopleRes.error);
  if (membershipRes.error) throw loadError("Failed to load workspace access", membershipRes.error);
  const p = profileRes.data;
  if (!p) return null;

  const memberOf = new Set(membershipRes.data.map((m) => m.workspace_id));
  const people = peopleRes.data;
  // Same lists as /team: managers are active Admins and Super Admins; departments are the presets plus those in use.
  const managers = people
    .filter((m) => m.is_active && m.role !== "INDIVIDUAL")
    .map((m) => ({ userId: m.id, name: displayName({ full_name: m.full_name, email: m.email }) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const used = people.map((m) => m.team?.trim()).filter((t): t is string => Boolean(t));
  const departments = [...new Set([...TEAM_OPTIONS, ...used])].sort((a, b) => a.localeCompare(b));

  return {
    member: {
      userId: p.id,
      name: displayName({ full_name: p.full_name, email: p.email }),
      fullName: p.full_name,
      email: p.email,
      role: p.role,
      isActive: p.is_active,
      jobTitle: p.job_title,
      managerId: p.manager_id,
      team: p.team,
      pendingInvite: Boolean(statuses.get(userId)?.pendingInvite),
    },
    managers,
    departments,
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, member: memberOf.has(w.id) })),
    memberWorkspaceId: workspaces.find((w) => memberOf.has(w.id))?.id ?? null,
  };
}
