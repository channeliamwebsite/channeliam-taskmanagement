import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

import { getPermissions, hasRole, type Permissions, type UserRole } from "./roles";
import { DEFAULT_AUTHENTICATED_ROUTE, LOGIN_ROUTE } from "./routes";

export type CurrentUser = {
  id: string;
  email: string | null;
};

export type CurrentProfile = {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  department: string | null;
  jobTitle: string | null;
  isActive: boolean;
};

export type Session = {
  user: CurrentUser;
  profile: CurrentProfile;
  permissions: Permissions;
};

/** Signs the user out and returns them to /login with a reason. */
export const SIGN_OUT_ROUTE = "/auth/signout";

/**
 * Verified identity of the caller, or null. Uses getClaims(), which validates
 * the JWT signature (never trust getSession() on the server).
 * Memoised per render pass with React `cache`.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) {
    return null;
  }

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
});

/**
 * Profile of the caller, read through RLS (own row). The role comes from the
 * database, not from the JWT, so role changes apply on the next request.
 */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, role, department, job_title, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    avatarUrl: data.avatar_url,
    role: data.role,
    department: data.department,
    jobTitle: data.job_title,
    isActive: data.is_active,
  };
});

/** Requires a signed-in user; otherwise redirects to /login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(LOGIN_ROUTE);
  }
  return user;
}

/**
 * Requires a signed-in user with an active profile. Deactivated or missing
 * profiles are signed out (cookies can only be cleared in a Route Handler or
 * Server Action, hence the redirect to the sign-out route).
 */
export async function requireSession(): Promise<Session> {
  const user = await requireUser();
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect(`${SIGN_OUT_ROUTE}?reason=profile_missing`);
  }
  if (!profile.isActive) {
    redirect(`${SIGN_OUT_ROUTE}?reason=account_inactive`);
  }

  return { user, profile, permissions: getPermissions(profile.role) };
}

/**
 * Requires one of the given roles. Users without it are sent to the default
 * authenticated route rather than shown a broken page.
 */
export async function requireRole(allowed: readonly UserRole[]): Promise<Session> {
  const session = await requireSession();
  if (!hasRole(session.profile.role, allowed)) {
    redirect(DEFAULT_AUTHENTICATED_ROUTE);
  }
  return session;
}
