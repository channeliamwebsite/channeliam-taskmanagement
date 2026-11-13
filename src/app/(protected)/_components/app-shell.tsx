import type { ReactNode } from "react";

import { MobileNav, Sidebar, type NavItem, type NavSection } from "@/components/app/nav";
import { NotificationsMenu, SearchBox, UserMenu, type NotificationItem } from "@/components/app/topbar-menus";
import { requireSession } from "@/lib/auth/dal";
import { ROLE_LABELS, getPermissions } from "@/lib/auth/roles";
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
  const notifications = await getNotifications(session.user.id);

  const permissions = getPermissions(session.profile.role);
  // Navigation adapts to the role. Hiding a link is only convenience: every
  // route still enforces access on the server (and in RLS).
  const role = session.profile.role;
  // Every role (2026-11-13 redesign): My Day, My Tasks, Daily Updates,
  // Calendar, Inbox, in this order. Dashboard is Super Admin's home only --
  // Admin's and Individual's /dashboard routes still exist and still work if
  // visited directly, they're just not linked here; My Day is each role's
  // actual home and already covers the same ground.
  const myWork: NavSection = {
    title: "My work",
    items: [
      { href: "/my-day", label: "My Day", icon: "myday" },
      { href: "/tasks", label: "My Tasks", icon: "tasks" },
      { href: "/reports", label: "Daily Updates", icon: "reports" },
      { href: "/calendar", label: "Calendar", icon: "calendar" },
      { href: "/inbox", label: "Inbox", icon: "inbox", badge: notifications.unread },
    ],
  };
  const clientsProjects: NavSection = {
    title: "Clients & Projects",
    items: [
      { href: "/clients", label: "Clients", icon: "clients" },
      { href: "/projects", label: "Projects", icon: "projects" },
      ...(permissions.viewTeamReports ? [{ href: "/client-reports", label: "Client Reports", icon: "myreports" } as NavItem] : []),
    ],
  };
  // Admin only: monitoring the team's work. No separate "Assign Tasks" entry
  // (2026-11-13 redesign) -- assignment happens inside My Tasks itself, which
  // already has the New Task button and the existing Team Board view.
  const team: NavSection = {
    title: "Team",
    items: [
      { href: "/team-today", label: "Team Progress", icon: "teamtoday" },
      { href: "/attendance", label: "Attendance", icon: "attendance" },
      { href: "/attendance/leave", label: "Leave / WFH", icon: "leave" },
    ],
  };
  // Admin only. Settings is also reachable from the header's account menu on
  // every role; listed here too so Admin's account surface is in one place.
  const adminAccount: NavSection = {
    title: "Account",
    items: [
      { href: "/attendance/profile", label: "My Profile", icon: "profile" },
      { href: "/settings", label: "Settings", icon: "settings" },
    ],
  };
  // Individual only.
  const individualAccount: NavSection = {
    title: "Account",
    items: [
      { href: "/attendance", label: "Attendance", icon: "attendance" },
      { href: "/attendance/leave", label: "Leave / WFH", icon: "leave" },
      { href: "/attendance/profile", label: "My Profile", icon: "profile" },
    ],
  };
  // Super admins (decided 2026-11-06): a company-level menu only. No personal
  // My Day / My Tasks / attendance pages (they do not check in); those pages
  // still exist for the other roles and keep their own access checks.
  const superAdminSections: NavSection[] = [
    {
      title: "Overview",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
        { href: "/team-today", label: "Team Today", icon: "teamtoday" },
        { href: "/team", label: "Employees", icon: "team" },
        { href: "/reports", label: "Daily Updates", icon: "reports" },
        { href: "/calendar", label: "Calendar", icon: "calendar" },
        { href: "/inbox", label: "Inbox", icon: "inbox", badge: notifications.unread },
      ],
    },
    {
      title: "Clients & Projects",
      items: [
        { href: "/clients", label: "Clients", icon: "clients" },
        { href: "/projects", label: "Projects", icon: "projects" },
        { href: "/client-reports", label: "Client Reports", icon: "myreports" },
      ],
    },
    {
      title: "HR & People",
      items: [
        { href: "/hr", label: "Team Attendance", icon: "teamattendance" },
        { href: "/hr/leave", label: "Leave Applications", icon: "leave" },
        // Employee directory (above) and Employee Profile (here) are
        // deliberately two different links to two different pages -- see
        // app-shell redesign notes.
        { href: "/hr/employees", label: "Employee Profile", icon: "employees" },
        { href: "/hr/holidays", label: "Public Holidays", icon: "holidays" },
        { href: "/hr/reports", label: "Monthly Reports", icon: "myreports" },
      ],
    },
    {
      title: "System",
      items: [
        { href: "/settings", label: "Settings", icon: "settings" },
        { href: "/bugs", label: "Bug Reports", icon: "bugs" },
      ],
    },
  ];
  const sections: NavSection[] =
    role === "INDIVIDUAL"
      ? [myWork, individualAccount]
      : role === "ADMIN"
        ? [myWork, clientsProjects, team, adminAccount]
        : superAdminSections;
  const homeHref = role === "SUPER_ADMIN" ? "/dashboard" : "/my-day";
  const name = displayName({ full_name: session.profile.fullName, email: session.profile.email });
  const roleLabel = ROLE_LABELS[session.profile.role];

  return (
    <div className="flex min-h-svh flex-1 bg-background">
      <Sidebar sections={sections} roleLabel={roleLabel} homeHref={homeHref} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/80 bg-card/85 px-4 backdrop-blur-md supports-backdrop-filter:bg-card/75 sm:px-6 lg:px-8">
          <MobileNav sections={sections} roleLabel={roleLabel} homeHref={homeHref} />
          <SearchBox />
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <NotificationsMenu items={notifications.list} unread={notifications.unread} />
            <UserMenu name={name} email={session.profile.email} roleLabel={roleLabel} userId={session.user.id} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-svh flex-1 bg-background" aria-busy="true">
      <div className="hidden w-64 border-r border-sidebar-border bg-sidebar lg:block" />
      <div className="flex flex-1 flex-col">
        <div className="h-16 border-b border-border/80 bg-card/85" />
        <div className="mx-auto w-full max-w-[90rem] space-y-4 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
          <div className="h-32 animate-pulse rounded-xl bg-muted/70" />
        </div>
      </div>
    </div>
  );
}
