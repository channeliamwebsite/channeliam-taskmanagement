// Add-employee workflow (pure orchestration, unit-tested). The server action
// in src/lib/actions/employees.ts supplies the real dependencies: Supabase
// Auth admin calls for the account and invitation, and the super admin's own
// RLS-scoped client for the membership and profile, so the database checks
// every write.

import { ROLES, isRole, type UserRole } from "./auth/roles.ts";

export const EMPLOYEE_EMAIL_MAX = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EmployeeInput = {
  email: string;
  fullName: string;
  /** Department (profiles.team). */
  team: string | null;
  /** Designation (profiles.job_title). */
  jobTitle: string | null;
  role: UserRole;
  managerId: string | null;
};

function text(value: unknown, max: number): string | null {
  const v = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return v ? v.slice(0, max) : null;
}

export function validateEmployeeInput(
  raw: Partial<Record<keyof EmployeeInput, unknown>>,
): { ok: true; value: EmployeeInput } | { ok: false; error: string } {
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, error: "Work email is required." };
  if (email.length > EMPLOYEE_EMAIL_MAX || !EMAIL_PATTERN.test(email)) return { ok: false, error: "Enter a valid work email address." };
  const fullName = text(raw.fullName, 200);
  if (!fullName) return { ok: false, error: "Full name is required." };
  const role = raw.role ?? ROLES.INDIVIDUAL;
  if (!isRole(role)) return { ok: false, error: "Choose a valid role." };
  const managerId = typeof raw.managerId === "string" && raw.managerId ? raw.managerId : null;
  if (managerId && !UUID.test(managerId)) return { ok: false, error: "Choose a valid reporting manager." };
  const team = typeof raw.team === "string" ? raw.team.trim() : "";
  if (team.length > 100) return { ok: false, error: "Department must be at most 100 characters." };
  const jobTitle = typeof raw.jobTitle === "string" ? raw.jobTitle.trim() : "";
  if (jobTitle.length > 200) return { ok: false, error: "Designation must be at most 200 characters." };
  return { ok: true, value: { email, fullName, team: team || null, jobTitle: jobTitle || null, role, managerId } };
}

export type Delivery = "email" | "link";

/** Each step returns an error message, or null on success. */
export type AddEmployeeDeps = {
  findAccount(email: string): Promise<{ userId: string; pendingInvite: boolean } | null>;
  isMember(userId: string): Promise<boolean>;
  /** Sends the invitation email; succeeds only if Supabase Auth accepted and sent it. */
  inviteByEmail(email: string, fullName: string): Promise<{ userId: string } | { error: string }>;
  /** Creates the invited account and returns a one-time link instead of sending email. */
  createInviteLink(email: string, fullName: string): Promise<{ userId: string; link: string } | { error: string }>;
  /** Adds the workspace membership; an existing membership counts as success. */
  addMembership(userId: string): Promise<string | null>;
  /** Sets the profile of an account created by this workflow (never an existing one). */
  applyProfile(userId: string, input: EmployeeInput): Promise<string | null>;
};

export type AddEmployeeResult =
  | { status: "created"; userId: string; delivery: "email" }
  | { status: "created"; userId: string; delivery: "link"; link: string }
  | { status: "added_existing"; userId: string }
  /** An account exists but is not in this workspace: ask before adding it. */
  | { status: "exists"; userId: string; pendingInvite: boolean }
  | { status: "duplicate" }
  /** Nothing was set up; no invitation was sent. */
  | { status: "invite_failed"; error: string }
  /** Some steps succeeded; `failed` says what still needs doing. */
  | { status: "partial"; userId: string; done: string[]; failed: string; link?: string };

export async function addEmployee(
  deps: AddEmployeeDeps,
  input: EmployeeInput,
  { delivery, addExisting = false }: { delivery: Delivery; addExisting?: boolean },
): Promise<AddEmployeeResult> {
  const existing = await deps.findAccount(input.email);

  if (existing) {
    if (await deps.isMember(existing.userId)) return { status: "duplicate" };
    if (!addExisting) return { status: "exists", userId: existing.userId, pendingInvite: existing.pendingInvite };
    const membershipError = await deps.addMembership(existing.userId);
    if (membershipError) return { status: "partial", userId: existing.userId, done: [], failed: `Workspace access: ${membershipError}` };
    // An existing account keeps its role (company-wide), status, name,
    // department, designation and manager: only the membership is added.
    // Changes to those go through Edit employee, explicitly.
    // An invitation that was never accepted (e.g. the email failed earlier) is issued again.
    if (existing.pendingInvite) return reissue(deps, input, delivery, existing.userId);
    return { status: "added_existing", userId: existing.userId };
  }

  let userId: string;
  let link: string | undefined;
  if (delivery === "email") {
    const invited = await deps.inviteByEmail(input.email, input.fullName);
    if ("error" in invited) return { status: "invite_failed", error: invited.error };
    userId = invited.userId;
  } else {
    const created = await deps.createInviteLink(input.email, input.fullName);
    if ("error" in created) return { status: "invite_failed", error: created.error };
    userId = created.userId;
    link = created.link;
  }

  // The account exists from here on. Never undo it: an invitation may already
  // be in the person's inbox. Report what is missing instead; the Employees
  // page can finish the setup.
  const done = [delivery === "email" ? "Account created and invitation email sent" : "Account created with an invite link"];
  const membershipError = await deps.addMembership(userId);
  if (membershipError) return { status: "partial", userId, done, failed: `Workspace access: ${membershipError}`, link };
  done.push("Added to the workspace");
  const profileError = await deps.applyProfile(userId, input);
  if (profileError) return { status: "partial", userId, done, failed: `Employee details: ${profileError}`, link };

  return link ? { status: "created", userId, delivery: "link", link } : { status: "created", userId, delivery: "email" };
}

async function reissue(deps: AddEmployeeDeps, input: EmployeeInput, delivery: Delivery, userId: string): Promise<AddEmployeeResult> {
  const done = ["Added to the workspace"];
  if (delivery === "email") {
    const r = await deps.inviteByEmail(input.email, input.fullName);
    if ("error" in r) return { status: "partial", userId, done, failed: `Invitation email: ${r.error}` };
    return { status: "created", userId, delivery: "email" };
  }
  const r = await deps.createInviteLink(input.email, input.fullName);
  if ("error" in r) return { status: "partial", userId, done, failed: `Invite link: ${r.error}` };
  return { status: "created", userId, delivery: "link", link: r.link };
}

/** The app's own invite-acceptance URL for a hashed token from Supabase Auth. */
export function inviteAcceptUrl(origin: string, hashedToken: string): string {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", "invite");
  return url.toString();
}
