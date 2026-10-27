import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { UserAvatar } from "@/components/app/user-avatar";
import { AddEmployeeButton, MemberActions } from "@/components/team/member-controls";
import { ROLE_LABELS, ROLES, ROUTE_ROLES } from "@/lib/auth/roles";
import { getAccountStatuses } from "@/lib/data/employees";
import { listTasks } from "@/lib/data/tasks";
import { getMyWorkspaces, getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { TEAM_OPTIONS, displayName, isOverdue } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Employees" };

const selectClass = "h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground";

export default async function TeamPage({ searchParams }: PageProps<"/team">) {
  const { session, workspace } = await getPageContext(ROUTE_ROLES["/team"]);
  if (!workspace) return <NoWorkspace session={session} />;

  const params = await searchParams;
  const get = (k: string) => (typeof params[k] === "string" ? (params[k] as string).trim() : "");
  const q = get("q").slice(0, 100);
  const dept = get("dept");
  const role = get("role");
  const active = get("active");

  const [members, tasks] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    // Open/overdue/blocked counts below only involve unfinished tasks.
    listTasks({ workspaceId: workspace.id, openOnly: true }),
  ]);
  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const me = session.user.id;

  // Super admin only: workspace access across the workspaces they manage, and
  // invitation / sign-in status from Supabase Auth (server-side lookup).
  const [workspaces, accessRows, accountStatus] = isSuperAdmin
    ? await Promise.all([
        getMyWorkspaces(),
        createClient().then((s) =>
          s.from("workspace_members").select("workspace_id, user_id").in("user_id", members.map((m) => m.userId)),
        ),
        getAccountStatuses(members.map((m) => m.userId)),
      ])
    : [[], { data: [] }, new Map()];
  const accessOf = new Set((accessRows.data ?? []).map((r) => `${r.workspace_id}:${r.user_id}`));
  const today = workspaceToday(workspace);
  const nameOf = new Map(members.map((m) => [m.userId, displayName({ full_name: m.fullName, email: m.email })]));

  const stats = new Map<string, { open: number; overdue: number; blocked: number }>();
  for (const t of tasks) {
    for (const a of t.assignees) {
      const s = stats.get(a.userId) ?? { open: 0, overdue: 0, blocked: 0 };
      if (t.status !== "COMPLETED" && t.status !== "CANCELLED") s.open += 1;
      if (t.status === "BLOCKED") s.blocked += 1;
      if (isOverdue(t.dueDate, t.status, today)) s.overdue += 1;
      stats.set(a.userId, s);
    }
  }

  const myTeam = members.filter((m) => m.managerId === me && m.isActive);
  const departments = [...new Set(members.map((m) => m.team?.trim()).filter((t): t is string => Boolean(t)))].sort((a, b) => a.localeCompare(b));
  const departmentOptions = [...new Set([...TEAM_OPTIONS, ...departments])].sort((a, b) => a.localeCompare(b));
  const filtered = members.filter((m) => {
    const name = nameOf.get(m.userId)!.toLowerCase();
    const needle = q.toLowerCase();
    if (q && ![name, m.email ?? "", m.jobTitle ?? ""].some((v) => v.toLowerCase().includes(needle))) return false;
    if (dept && (dept === "__none__" ? Boolean(m.team?.trim()) : m.team?.trim().toLowerCase() !== dept.toLowerCase())) return false;
    if (role && m.role !== role) return false;
    if (active === "active" && !m.isActive) return false;
    if (active === "inactive" && m.isActive) return false;
    return true;
  });
  const managers = members
    .filter((m) => m.isActive && m.role !== "INDIVIDUAL")
    .map((m) => ({ userId: m.userId, name: nameOf.get(m.userId)! }));

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${members.length} employee${members.length === 1 ? "" : "s"} in ${workspace.name}${isSuperAdmin ? "" : " · counts reflect tasks you can see"}`}
        actions={isSuperAdmin ? <AddEmployeeButton workspaceId={workspace.id} managers={managers} departments={departmentOptions} /> : null}
      />

      <Section title={`My team (${myTeam.length} direct report${myTeam.length === 1 ? "" : "s"})`} className="mb-6">
        {myTeam.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody reports to you yet.{isSuperAdmin ? " Set “Reports to” for members below." : " A super admin sets reporting lines."}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {myTeam.map((m) => {
              const s = stats.get(m.userId) ?? { open: 0, overdue: 0, blocked: 0 };
              return (
                <li key={m.userId} className="flex items-center gap-3 rounded-lg border p-3">
                  <UserAvatar name={nameOf.get(m.userId)!} seed={m.userId} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/tasks?scope=all&assignee=${m.userId}`} className="block truncate text-sm font-medium hover:underline">
                      {nameOf.get(m.userId)}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {s.open} open ·{" "}
                      <span className={cn(s.overdue && "font-medium text-red-600")}>{s.overdue} overdue</span> ·{" "}
                      <span className={cn(s.blocked && "font-medium text-red-600")}>{s.blocked} blocked</span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <form action="/team" className="mb-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Search
          <input type="search" name="q" defaultValue={q} placeholder="Name, email or designation" className={cn(selectClass, "w-56 px-2.5")} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Department
          <select name="dept" defaultValue={dept} className={selectClass}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="__none__">No department</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Role
          <select name="role" defaultValue={role} className={selectClass}>
            <option value="">All roles</option>
            {Object.values(ROLES).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Status
          <select name="active" defaultValue={active} className={selectClass}>
            <option value="">Active and inactive</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">
          Apply
        </button>
        <Link href="/team" className="h-9 px-2 text-sm leading-9 text-muted-foreground hover:underline">
          Clear
        </Link>
        <span className="ml-auto self-center text-xs text-muted-foreground">
          Showing {filtered.length} of {members.length}
        </span>
      </form>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title={members.length ? "No members match these filters" : "No members yet"} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Department</th>
                <th className="px-3 py-2 font-medium">Reports to</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
                <th className="px-3 py-2 text-right font-medium">Overdue</th>
                <th className="px-3 py-2 text-right font-medium">Blocked</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {isSuperAdmin ? <th className="w-12 px-3 py-2"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((m) => {
                const name = nameOf.get(m.userId)!;
                const s = stats.get(m.userId) ?? { open: 0, overdue: 0, blocked: 0 };
                return (
                  <tr key={m.userId} className={cn(!m.isActive && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <UserAvatar name={name} seed={m.userId} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {name}
                            {m.userId === me ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{[m.jobTitle, m.email].filter(Boolean).join(" · ")}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{ROLE_LABELS[m.role]}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{m.team || "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{m.managerId ? nameOf.get(m.managerId) ?? "—" : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.open}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", s.overdue && "font-medium text-red-600")}>{s.overdue}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", s.blocked && "font-medium text-red-600")}>{s.blocked}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", m.isActive ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600")}>
                          {m.isActive ? "Active" : "Inactive"}
                        </span>
                        {accountStatus.get(m.userId)?.pendingInvite ? (
                          <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Invite pending</span>
                        ) : null}
                        {m.isActive && accountStatus.get(m.userId)?.signInBlocked ? (
                          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Sign-in blocked</span>
                        ) : null}
                      </span>
                    </td>
                    {isSuperAdmin ? (
                      <td className="px-3 py-2.5 text-right">
                        <MemberActions
                          workspaceId={workspace.id}
                          isSelf={m.userId === me}
                          managers={managers}
                          departments={departmentOptions}
                          workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, member: accessOf.has(`${w.id}:${m.userId}`) }))}
                          member={{
                            userId: m.userId,
                            name,
                            fullName: m.fullName,
                            email: m.email,
                            role: m.role,
                            isActive: m.isActive,
                            canCreateProjects: m.canCreateProjects,
                            jobTitle: m.jobTitle,
                            managerId: m.managerId,
                            team: m.team,
                            pendingInvite: Boolean(accountStatus.get(m.userId)?.pendingInvite),
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
