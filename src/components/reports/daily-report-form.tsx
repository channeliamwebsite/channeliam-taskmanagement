"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveDailyReport } from "@/lib/actions/reports";
import { cn } from "@/lib/utils";

export type DailyReportValues = {
  totalHours: string;
  accomplishments: string;
  workRemaining: string;
  blockers: string;
  tomorrowPlan: string;
};

type TaskRef = { id: string; title: string };

function TaskGroup({ label, tasks, tone }: { label: string; tasks: TaskRef[]; tone: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="flex items-baseline justify-between text-xs font-medium text-muted-foreground">
        {label}
        <span className={cn("text-lg font-semibold tabular-nums", tone)}>{tasks.length}</span>
      </p>
      {tasks.length ? (
        <ul className="mt-1.5 grid gap-0.5">
          {tasks.slice(0, 6).map((t) => (
            <li key={t.id} className="truncate text-xs">
              <Link href={`/tasks/${t.id}`} className="hover:underline">
                {t.title}
              </Link>
            </li>
          ))}
          {tasks.length > 6 ? <li className="text-xs text-muted-foreground">+{tasks.length - 6} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function DailyReportForm({
  workspaceId,
  initial,
  isUpdate,
  completed,
  notCompleted,
  blocked,
}: {
  workspaceId: string;
  initial: DailyReportValues;
  isUpdate: boolean;
  completed: TaskRef[];
  notCompleted: TaskRef[];
  blocked: TaskRef[];
}) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof DailyReportValues, v: string) => setValues((s) => ({ ...s, [k]: v }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const h = values.totalHours === "" ? null : Number(values.totalHours);
    if (h !== null && (!Number.isFinite(h) || h < 0 || h > 24)) return setError("Hours must be between 0 and 24.");
    startTransition(async () => {
      const r = await saveDailyReport({ workspaceId, ...values, totalHours: h });
      if (r.ok) toast.success(isUpdate ? "Daily update saved" : "Daily update submitted");
      else setError(r.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <TaskGroup label="Completed today" tasks={completed} tone="text-emerald-600" />
        <TaskGroup label="Not completed" tasks={notCompleted} tone={notCompleted.length ? "text-amber-600" : ""} />
        <TaskGroup label="Blocked" tasks={blocked} tone={blocked.length ? "text-red-600" : ""} />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Counts come from your tasks and are recorded when you submit.</p>
      <div className="grid gap-1.5">
        <Label htmlFor="report-accomplishments">Accomplishments</Label>
        <Textarea id="report-accomplishments" value={values.accomplishments} onChange={(e) => set("accomplishments", e.target.value)} rows={3} maxLength={10000} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="report-remaining">Reasons for incomplete tasks</Label>
        <Textarea id="report-remaining" value={values.workRemaining} onChange={(e) => set("workRemaining", e.target.value)} rows={2} maxLength={10000} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="report-blockers">Blockers</Label>
        <Textarea id="report-blockers" value={values.blockers} onChange={(e) => set("blockers", e.target.value)} rows={2} maxLength={10000} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="report-tomorrow">Tomorrow&apos;s priorities</Label>
        <Textarea id="report-tomorrow" value={values.tomorrowPlan} onChange={(e) => set("tomorrowPlan", e.target.value)} rows={2} maxLength={10000} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="report-hours">Hours worked (optional)</Label>
          <Input
            id="report-hours"
            type="number"
            min={0}
            max={24}
            step={0.25}
            inputMode="decimal"
            value={values.totalHours}
            onChange={(e) => set("totalHours", e.target.value)}
            className="h-9 w-32"
          />
        </div>
        <Button type="submit" disabled={pending} className="h-9">
          {pending ? <Loader2 className="animate-spin" /> : null}
          {isUpdate ? "Update daily update" : "Submit daily update"}
        </Button>
      </div>
    </form>
  );
}
