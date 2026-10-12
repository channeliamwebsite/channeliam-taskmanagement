"use client";

import { Bell, CheckCheck, LogOut, Search, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/app/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { signOut } from "@/lib/auth/actions";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import { formatDateTime } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const q = value.trim();
    router.push(q ? `/tasks?scope=all&q=${encodeURIComponent(q)}` : "/tasks");
  }

  return (
    <form onSubmit={onSubmit} role="search" className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search tasks…"
        aria-label="Search tasks"
        className="h-9 pl-8"
      />
    </form>
  );
}

export type NotificationItem = {
  id: string;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: string;
  taskId: string | null;
};

export function NotificationsMenu({ items, unread }: { items: NotificationItem[]; unread: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex size-9 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="size-4" aria-hidden="true" />
        {unread > 0 ? (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <div className="flex items-center justify-between px-1.5 py-1">
            <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
            {unread > 0 ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  startTransition(async () => {
                    const r = await markAllNotificationsRead();
                    if (!r.ok) toast.error(r.error);
                  })
                }
              >
                <CheckCheck className="size-3.5" aria-hidden="true" /> Mark all read
              </button>
            ) : null}
          </div>
          <DropdownMenuSeparator />
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex-col items-start gap-0.5 py-2"
                onClick={() =>
                  startTransition(async () => {
                    if (!n.isRead) await markNotificationRead(n.id);
                    if (n.taskId) router.push(`/tasks/${n.taskId}`);
                  })
                }
              >
                <span className="flex w-full items-center gap-2">
                  <span className={cn("size-1.5 shrink-0 rounded-full", n.isRead ? "bg-transparent" : "bg-blue-500")} />
                  <span className="flex-1 truncate font-medium">{n.title}</span>
                </span>
                {n.message ? <span className="line-clamp-2 pl-3.5 text-xs text-muted-foreground">{n.message}</span> : null}
                <span className="pl-3.5 text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserMenu({ name, email, roleLabel, userId }: { name: string; email: string | null; roleLabel: string; userId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-2 rounded-lg p-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Account menu"
      >
        <UserAvatar name={name} seed={userId} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            {email ? <span className="truncate text-xs">{email}</span> : null}
            <span className="text-xs">{roleLabel}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <Settings aria-hidden="true" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
