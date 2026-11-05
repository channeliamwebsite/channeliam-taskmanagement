import type { ReactNode } from "react";

import { MobileNav, Sidebar, type NavItem, type NavSection } from "@/components/app/nav";
import { NotificationsMenu, SearchBox, UserMenu, type NotificationItem } from "@/components/app/topbar-menus";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { requireSession } from "@/lib/auth/dal";
import { ROLE_LABELS, getPermissions } from "@/lib/auth/roles";
import { getActiveWorkspace, getMyWorkspaces } from "@/lib/data/workspace";
import { displayName } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";

async function getNotifications(userId: string) {
  const supabase = await createClient();
  const [{ data: items }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, message, is_read, created_at, task_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false),
  ]);
  const list: NotificationItem[] = (items ?? []).map((n) => ({
    id: n.id,
    title: n.title,
    message: n.message,
    isRead: n.is_read,
    createdAt: n.created_at,
    taskId: n.task_id,
    type: n.type,
  }));
  return { list, unread: count ?? 0 };
}

export async function AppShell({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const [workspaces, active, notifications] = await Promise.all([
    getMyWorkspaces(),
    getActiveWorkspace(),
    getNotifications(session.user.id),
  ]);

  const permissions = getPermissions(session.profile.role);
  // Navigation adapts to the role. Hiding a link is only convenience: every
  // route still enforces access on the server (and in RLS).
  const role = session.profile.role;
  const myWork: NavSection = {
    title: "My work",
    items: [
      { href: "/my-day", label: "My Day", icon: "myday" },
      // Admins and super admins reach the dashboard from the Workspace section.
      ...(role === "INDIVIDUAL" ? [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" } as NavItem] : []),
      { href: "/tasks", label: "My Tasks", icon: "tasks" },
      { href: "/calendar", label: "Calendar", icon: "calendar" },
      { href: "/inbox", label: "Inbox", icon: "inbox", badge: notifications.unread },
      ...(permissions.viewTeamReports ? [] : [{ href: "/reports", label: "Daily Update", icon: "reports" } as NavItem]),
    ],
  };
  const team: NavSection = {
    title: "Team",
    items: [
      { href: "/team-today", label: "Team Today", icon: "teamtoday" },
      { href: "/team", label: role === "SUPER_ADMIN" ? "Employees" : "Team", icon: "team" },
      { href: "/reports", label: "Daily Updates", icon: "reports" },
    ],
  };
  // Everyone records their own attendance, super admins included. Super
  // admins also get the company-wide HR pages (the /hr routes check the role).
  const myAttendance: NavItem[] = [
    { href: "/attendance", label: "My Attendance", icon: "attendance" },
    // Super admins decide leave under Attendance & HR; they do not apply for it.
    ...(role === "SUPER_ADMIN" ? [] : [{ href: "/attendance/leave", label: "Leave Applications", icon: "leave" } as NavItem]),
    { href: "/attendance/profile", label: "My Profile", icon: "profile" },
    { href: "/attendance/reports", label: "My Reports", icon: "myreports" },
  ];
  const attendanceHr: NavSection = {
    title: "Attendance & HR",
    items:
      role === "SUPER_ADMIN"
        ? [
            { href: "/hr", label: "Team Attendance", icon: "teamattendance" },
            { href: "/hr/leave", label: "Leave Applications", icon: "leave" },
            { href: "/hr/employees", label: "Employee Profiles", icon: "employees" },
            { href: "/hr/holidays", label: "Public Holidays", icon: "holidays" },
            { href: "/hr/reports", label: "Monthly Reports", icon: "myreports" },
            ...myAttendance,
          ]
        : myAttendance,
  };
  const workspaceNav: NavSection = {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/clients", label: "Clients", icon: "clients" },
      ...(permissions.viewTeamReports ? [{ href: "/client-reports", label: "Client Reports", icon: "myreports" } as NavItem] : []),
      { href: "/projects", label: "Projects", icon: "projects" },
      // Task boards are for admins managing their team's work, not for super admins.
      ...(role === "SUPER_ADMIN" ? [] : [{ href: "/tasks?view=board&scope=all", label: "Task Board", icon: "board" } as NavItem]),
    ],
  };
  // The single Bug Reports entry, for every role: the page holds the form and the list.
  const settings: NavSection = {
    title: "Settings",
    items: [
      { href: "/settings", label: "Settings", icon: "settings" },
      { href: "/bugs", label: "Bug Reports", icon: "bugs" },
    ],
  };
  // Individuals: just their day. Admins: their day, then their team.
  // Super admins: the team first, then their own work.
  const sections: NavSection[] =
    role === "INDIVIDUAL"
      ? [myWork, attendanceHr, settings]
      : role === "ADMIN"
        ? [myWork, attendanceHr, team, workspaceNav, settings]
        : [team, myWork, attendanceHr, workspaceNav, settings];
  const switcher = <WorkspaceSwitcher workspaces={workspaces} activeId={active?.id ?? null} />;
  const name = displayName({ full_name: session.profile.fullName, email: session.profile.email });

  return (
    <div className="flex min-h-svh flex-1">
      <Sidebar sections={sections} workspaceSwitcher={switcher} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-6">
          <MobileNav sections={sections} workspaceSwitcher={switcher} />
          <SearchBox />
          <div className="ml-auto flex items-center gap-1">
            <NotificationsMenu items={notifications.list} unread={notifications.unread} />
            <UserMenu
              name={name}
              email={session.profile.email}
              roleLabel={ROLE_LABELS[session.profile.role]}
              userId={session.user.id}
            />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh flex-1" aria-busy="true">
      <div className="hidden w-60 border-r bg-muted/30 lg:block" />
      <div className="flex flex-1 flex-col">
        <div className="h-14 border-b" />
        <div className="mx-auto w-full max-w-7xl space-y-4 px-6 py-6">
          <div className="h-7 w-48 animate-pulse rounded bg-muted" />
          <div className="h-32 animate-pulse rounded-xl bg-muted/60" />
        </div>
      </div>
    </div>
  );
}
