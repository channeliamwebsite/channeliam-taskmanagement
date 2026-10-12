import { Inbox } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/app/page-header";
import { InboxList } from "@/components/app/inbox-list";
import { createClient } from "@/lib/supabase/server";

import { getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const { session } = await getPageContext();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, message, is_read, created_at, task_id")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Failed to load notifications");

  const unread = data.filter((n) => !n.is_read).length;

  return (
    <>
      <PageHeader title="Inbox" description={unread ? `${unread} unread` : "You're all caught up."} />
      {data.length === 0 ? (
        <EmptyState icon={Inbox} title="No notifications yet" description="Assignments, comments, blocked tasks and review requests appear here." />
      ) : (
        <InboxList
          unread={unread}
          items={data.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            message: n.message,
            isRead: n.is_read,
            createdAt: n.created_at,
            taskId: n.task_id,
          }))}
        />
      )}
    </>
  );
}
