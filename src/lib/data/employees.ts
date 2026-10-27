import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type AccountStatus = {
  /** Invited but never signed in / confirmed. */
  pendingInvite: boolean;
  /** Sign-in blocked in Supabase Auth (set when an employee is deactivated). */
  signInBlocked: boolean;
};

/**
 * Supabase Auth status for the given users. Service-role read: call only after
 * the caller is verified as a super admin. Returns an empty map when the
 * service-role key is not configured (the page then shows no auth status).
 */
export async function getAccountStatuses(userIds: readonly string[]): Promise<Map<string, AccountStatus>> {
  const result = new Map<string, AccountStatus>();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || userIds.length === 0) return result;
  const wanted = new Set(userIds);
  const admin = createAdminClient();
  const now = Date.now();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return result;
    for (const u of data.users) {
      if (!wanted.has(u.id)) continue;
      result.set(u.id, {
        pendingInvite: !u.email_confirmed_at && !u.last_sign_in_at,
        signInBlocked: Boolean(u.banned_until && Date.parse(u.banned_until) > now),
      });
    }
    if (data.users.length < 1000 || result.size === wanted.size) break;
  }
  return result;
}
