// Pure company-wide employee aggregation (no I/O, unit-tested): combines
// several department workspaces' member lists into one deduplicated,
// per-employee list for a company-wide view (Super Admin's Employees page).

/** Department workspaces only -- never a personal workspace (own or anyone else's). */
export function departmentWorkspacesOf<W extends { isPersonal: boolean }>(workspaces: W[]): W[] {
  return workspaces.filter((w) => !w.isPersonal);
}

/**
 * One row per user_id across however many department workspaces' member
 * lists are passed in. A user present in more than one list keeps the first
 * one found (the order callers pass workspaces in) -- that workspaceId is
 * what member actions (remove, workspace access flags) apply to.
 */
export function mergeCompanyMembers<M extends { userId: string; fullName: string | null; email: string | null }>(
  perWorkspace: { workspaceId: string; members: M[] }[],
): (M & { workspaceId: string })[] {
  const byUser = new Map<string, M & { workspaceId: string }>();
  for (const { workspaceId, members } of perWorkspace) {
    for (const m of members) {
      if (!byUser.has(m.userId)) byUser.set(m.userId, { ...m, workspaceId });
    }
  }
  return [...byUser.values()].sort((a, b) => (a.fullName || a.email || "").localeCompare(b.fullName || b.email || ""));
}
