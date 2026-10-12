import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { UserAvatar } from "@/components/app/user-avatar";
import { AddMemberButton, MemberActions } from "@/components/team/member-controls";
import { ROLE_LABELS, ROUTE_ROLES } from "@/lib/auth/roles";
import { listTasks } from "@/lib/data/tasks";
import { getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { displayName, isOverdue } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { session, workspace } = await getPageContext(ROUTE_ROLES["/team"]);
  if (!workspace) return <NoWorkspace session={session} />;

  const [members, tasks] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    listTasks({ workspaceId: workspace.id }),
  ]);
  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const me = session.user.id;
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
  const managers = members
    .filter((m) => m.isActive && m.role !== "INDIVIDUAL")
    .map((m) => ({ userId: m.userId, name: nameOf.get(m.userId)! }));

  return (
    <>
      <PageHeader
        title="Team"
        description={`${members.length} member${members.length === 1 ? "" : "s"} in ${workspace.name}${isSuperAdmin ? "" : " · counts reflect tasks you can see"}`}
        actions={isSuperAdmin ? <AddMemberButton workspaceId={workspace.id} /> : null}
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

      {members.length === 0 ? (
        <EmptyState icon={Users} title="No members yet" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Member</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Reports to</th>
                <th className="px-3 py-2 text-right font-medium">Open</th>
                <th className="px-3 py-2 text-right font-medium">Overdue</th>
                <th className="px-3 py-2 text-right font-medium">Blocked</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {isSuperAdmin ? <th className="w-12 px-3 py-2"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((m) => {
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
                          <span className="block truncate text-xs text-muted-foreground">{m.jobTitle || m.email}</span>
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
                      <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", m.isActive ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600")}>
                        {m.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    {isSuperAdmin ? (
                      <td className="px-3 py-2.5 text-right">
                        <MemberActions
                          workspaceId={workspace.id}
                          isSelf={m.userId === me}
                          managers={managers}
                          member={{
                            userId: m.userId,
                            name,
                            role: m.role,
                            isActive: m.isActive,
                            canCreateProjects: m.canCreateProjects,
                            department: m.department,
                            jobTitle: m.jobTitle,
                            managerId: m.managerId,
                            team: m.team,
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
