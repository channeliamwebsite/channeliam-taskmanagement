"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/app/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addComment, deleteComment } from "@/lib/actions/tasks";
import { formatDateTime } from "@/lib/domain";

export type CommentView = {
  id: string;
  comment: string;
  createdAt: string;
  userId: string | null;
  authorName: string | null;
};

export function TaskComments({
  taskId,
  comments,
  currentUserId,
  canModerate,
}: {
  taskId: string;
  comments: CommentView[];
  currentUserId: string;
  canModerate: boolean;
}) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    startTransition(async () => {
      const r = await addComment(taskId, text);
      if (r.ok) {
        setText("");
        toast.success("Comment added");
      } else toast.error(r.error);
    });
  }

  return (
    <div className="grid gap-4">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet. Start the conversation.</p>
      ) : (
        <ul className="grid gap-4">
          {comments.map((c) => {
            const name = c.authorName ?? "Former user";
            const canDelete = c.userId === currentUserId || canModerate;
            return (
              <li key={c.id} className="flex gap-3">
                <UserAvatar name={name} seed={c.userId ?? c.id} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                    {canDelete ? (
                      <button
                        type="button"
                        className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                        aria-label="Delete comment"
                        disabled={deleting === c.id}
                        onClick={async () => {
                          setDeleting(c.id);
                          const r = await deleteComment(c.id);
                          setDeleting(null);
                          if (r.ok) toast.success("Comment deleted");
                          else toast.error(r.error);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap break-words">{c.comment}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={onSubmit} className="grid gap-2">
        <label htmlFor="new-comment" className="sr-only">
          Add a comment
        </label>
        <Textarea
          id="new-comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a comment…"
          rows={3}
          maxLength={10000}
          disabled={pending}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={pending || !text.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}
