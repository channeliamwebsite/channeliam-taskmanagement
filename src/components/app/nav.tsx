"use client";

import {
  BarChart3,
  Briefcase,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Menu,
  Settings,
  Sun,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const ICONS = {
  dashboard: LayoutDashboard,
  myday: Sun,
  calendar: CalendarDays,
  clients: Briefcase,
  tasks: CheckSquare,
  board: KanbanSquare,
  inbox: Inbox,
  projects: FolderKanban,
  team: Users,
  reports: BarChart3,
  settings: Settings,
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
    const pathMatch = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return pathMatch && !all.some((o) => o !== item && o.href.includes("?") && queryMatch(o.href));
  };
}

function NavLinks({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const isActive = useIsActive(sections);
  return (
    <nav className="grid gap-4" aria-label="Main">
      {sections.map((section) => (
        <div key={section.title} className="grid gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</p>
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
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-primary/[0.07] text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className={cn("size-4", active && "text-primary")} aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {item.badge ? (
                  <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white tabular-nums">
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

function Brand() {
  return (
    <Link href="/my-day" className="flex items-center gap-2 px-1 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ListChecks className="size-4" aria-hidden="true" />
      </span>
      Task Management
    </Link>
  );
}

export function Sidebar({ sections, workspaceSwitcher }: { sections: NavSection[]; workspaceSwitcher: ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-muted/30 px-3 py-4 lg:flex">
      <Brand />
      {workspaceSwitcher}
      <NavLinks sections={sections} />
    </aside>
  );
}

export function MobileNav({ sections, workspaceSwitcher }: { sections: NavSection[]; workspaceSwitcher: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
        <Menu />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 gap-4 overflow-y-auto p-4">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand />
          </SheetHeader>
          {workspaceSwitcher}
          <NavLinks sections={sections} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
