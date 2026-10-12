"use client";

import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/actions/notifications";
import { formatDateTime } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function InboxList({
  items,
  unread,
}: {
  items: { id: string; type: string; title: string; message: string | null; isRead: boolean; createdAt: string; taskId: string | null }[];
  unread: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-3">
      {unread ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await markAllNotificationsRead();
                if (!r.ok) toast.error(r.error);
              })
            }
          >
            <CheckCheck aria-hidden="true" /> Mark all read
          </Button>
        </div>
      ) : null}
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className={cn("flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40", !n.isRead && "bg-blue-50/40")}
              onClick={() =>
                startTransition(async () => {
                  if (!n.isRead) await markNotificationRead(n.id);
                  router.push(n.taskId ? `/tasks/${n.taskId}` : "/my-day");
                })
              }
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.isRead ? "bg-transparent" : "bg-blue-500")} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{n.title}</span>
                {n.message ? <span className="block text-sm text-muted-foreground">{n.message}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
