"use client";

import {
  BarChart3,
  Briefcase,
  Bug,
  CalendarDays,
  CalendarClock,
  CalendarHeart,
  CalendarOff,
  CheckSquare,
  ClipboardCheck,
  Contact,
  FileSpreadsheet,
  IdCard,
  FolderKanban,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Menu,
  UserCheck,
  Settings,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { BrandFooterCard, BrandLockup } from "@/components/app/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ICONS = {
  dashboard: LayoutDashboard,
  myday: Sun,
  calendar: CalendarDays,
  attendance: CalendarClock,
  clients: Briefcase,
  tasks: CheckSquare,
  board: KanbanSquare,
  inbox: Inbox,
  projects: FolderKanban,
  team: Users,
  teamtoday: UserCheck,
  reports: BarChart3,
  settings: Settings,
  bugs: Bug,
  leave: CalendarOff,
  profile: IdCard,
  myreports: FileSpreadsheet,
  teamattendance: ClipboardCheck,
  employees: Contact,
  holidays: CalendarHeart,
} satisfies Record<string, LucideIcon>;

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };
export type NavSection = { title: string; items: NavItem[] };

/** Links with a query string (e.g. Task Board) are active only when their params match. */
function useIsActive(sections: NavSection[]) {
  const pathname = usePathname();
  const params = useSearchParams();
  const all = sections.flatMap((s) => s.items);
  const queryMatch = (href: string) => {
    const [path, query] = href.split("?");
    if (pathname !== path || !query) return false;
    return [...new URLSearchParams(query).entries()].every(([k, v]) => params.get(k) === v);
  };
  return (item: NavItem) => {
    if (item.href.includes("?")) return queryMatch(item.href);
    const pathMatch = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
    // A nested link (e.g. /attendance/leave) wins over its parent (/attendance).
    const deeper = all.some((o) => o !== item && !o.href.includes("?") && o.href.startsWith(`${item.href}/`) && pathMatch(o.href));
    return pathMatch(item.href) && !deeper && !all.some((o) => o !== item && o.href.includes("?") && queryMatch(o.href));
  };
}

function NavLinks({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const isActive = useIsActive(sections);
  return (
    <nav className="grid gap-1" aria-label="Main">
      {sections.map((section, index) => (
        <div key={section.title} className={cn("grid gap-0.5", index > 0 && "mt-2 border-t border-sidebar-border pt-4")}>
          <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{section.title}</p>
          {section.items.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group/nav flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("size-[18px] shrink-0", active ? "text-primary" : "text-muted-foreground group-hover/nav:text-foreground")}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge ? (
                  <span className="min-w-5 rounded-full bg-brand-soft px-1.5 py-0.5 text-center text-[11px] leading-none font-semibold text-brand-soft-foreground tabular-nums">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Brand({ roleLabel, homeHref = "/my-day" }: { roleLabel?: string; homeHref?: string }) {
  return (
    <Link href={homeHref} className="rounded-lg px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/40" aria-label="Home">
      <BrandLockup role={roleLabel} />
    </Link>
  );
}

type ShellNavProps = { sections: NavSection[]; workspaceSwitcher: ReactNode; roleLabel?: string; homeHref?: string };

export function Sidebar({ sections, workspaceSwitcher, roleLabel, homeHref }: ShellNavProps) {
  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
      <Brand roleLabel={roleLabel} homeHref={homeHref} />
      {workspaceSwitcher}
      <NavLinks sections={sections} />
      <div className="mt-auto pt-2">
        <BrandFooterCard />
      </div>
    </aside>
  );
}

export function MobileNav({ sections, workspaceSwitcher, roleLabel, homeHref }: ShellNavProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="icon" className="shrink-0 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
        <Menu />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[18rem] max-w-[85vw] gap-5 overflow-y-auto bg-sidebar px-4 py-5">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand roleLabel={roleLabel} homeHref={homeHref} />
          </SheetHeader>
          {workspaceSwitcher}
          <NavLinks sections={sections} onNavigate={() => setOpen(false)} />
          <div className="mt-auto pt-2">
            <BrandFooterCard />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
