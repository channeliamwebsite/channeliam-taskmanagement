"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { approveTask } from "@/lib/actions/tasks";

/** Approves a task awaiting review; the server re-checks the reviewer's permission. */
export function ApproveTaskButton({ taskId, title }: { taskId: string; title: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-8 shrink-0"
      disabled={pending}
      aria-label={`Approve ${title}`}
      onClick={() =>
        startTransition(async () => {
          const r = await approveTask(taskId);
          if (r.ok) toast.success("Task approved");
          else toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 aria-hidden="true" />}
      Approve
    </Button>
  );
}
