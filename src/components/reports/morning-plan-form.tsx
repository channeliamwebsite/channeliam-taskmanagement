"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { PriorityBadge } from "@/components/app/badges";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveMorningPlan } from "@/lib/actions/reports";
import { formatDateTime, type Priority } from "@/lib/domain";
import { updatedAfterSubmission } from "@/lib/report-history";

export type PlannedTask = {
  id: string;
  title: string;
  where: string;
  priority: Priority;
  carried: boolean;
};

export function MorningPlanForm({
  workspaceId,
  tasks,
  initialNotes,
  submittedAt,
  updatedAt = null,
}: {
  workspaceId: string;
  tasks: PlannedTask[];
  initialNotes: string;
  submittedAt: string | null;
  /** daily_reports.updated_at: changes whenever the morning plan or evening report is saved. */
  updatedAt?: string | null;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const r = await saveMorningPlan(workspaceId, notes);
      if (r.ok) toast.success(submittedAt ? "Morning plan updated" : "Morning plan submitted");
      else toast.error(r.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-1.5">
        <p className="text-sm font-medium">Planned for today ({tasks.length})</p>
        {tasks.length ? (
          <ul className="divide-y rounded-lg border">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:underline">
                    {t.title}
                  </Link>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.where || "Internal"}
                    {t.carried ? " · carried forward" : ""}
                  </span>
                </div>
                <PriorityBadge priority={t.priority} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No tasks planned for today yet. Add tasks from My Day.</p>
        )}
        <p className="text-xs text-muted-foreground">Taken from your tasks (scheduled today, carried forward and blocked).</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="morning-notes">Plan notes (optional)</Label>
        <Textarea
          id="morning-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={10000}
          placeholder="Focus, order of work, dependencies…"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {submittedAt ? `First submitted ${formatDateTime(submittedAt)} IST` : "Not submitted yet"}
          {submittedAt && updatedAt && updatedAfterSubmission(updatedAt, submittedAt) ? ` · last saved ${formatDateTime(updatedAt)} IST` : ""}
        </span>
        <Button type="submit" disabled={pending} className="h-9">
          {pending ? <Loader2 className="animate-spin" /> : null}
          {submittedAt ? "Update morning plan" : "Submit morning plan"}
        </Button>
      </div>
    </form>
  );
}
