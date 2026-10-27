import { UserAvatar } from "@/components/app/user-avatar";
import { formatDateTime, isTaskStatus, TASK_STATUS_LABELS } from "@/lib/domain";
import { OUTCOME_LABELS, SUBMISSION_LABELS, type ComparedTask, type Comparison, type Outcome, type Submission } from "@/lib/report-compare";
import { cn } from "@/lib/utils";

export type ComparisonRow = {
  userId: string;
  name: string;
  roleLabel: string | null;
  team: string | null;
  badge: string | null;
  comparison: Comparison;
  morningPlan: string | null;
  accomplishments: string | null;
  workRemaining: string | null;
  blockers: string | null;
  morningSubmittedAt: string | null;
  eveningSubmittedAt: string | null;
  /** Counts stored with the evening report (shown when it has no task snapshot). */
  storedCounts: { completed: number; notCompleted: number; blocked: number } | null;
};

const SUBMISSION_TONE: Record<Submission, string> = {
  both: "bg-emerald-50 text-emerald-700",
  morning_only: "bg-amber-50 text-amber-800",
  evening_only: "bg-amber-50 text-amber-800",
  none: "bg-red-50 text-red-700",
};

const OUTCOME_TONE: Record<Outcome, string> = {
  completed: "bg-emerald-50 text-emerald-700",
  partial: "bg-blue-50 text-blue-700",
  pending: "bg-zinc-100 text-zinc-700",
  blocked: "bg-red-50 text-red-700",
  no_tasks: "bg-zinc-100 text-zinc-700",
  unknown: "bg-zinc-100 text-zinc-700",
};

function statusText(status: string | null) {
  if (status === null) return "not in evening report";
  return isTaskStatus(status) ? TASK_STATUS_LABELS[status] : status;
}

function TaskList({ tasks, showStatus = false }: { tasks: ComparedTask[]; showStatus?: boolean }) {
  if (!tasks.length) return null;
  return (
    <ul className="grid gap-0.5">
      {tasks.map((t) => (
        <li key={t.id} className="break-words">
          {showStatus && t.status === "COMPLETED" ? "✓ " : "• "}
          {t.title}
          {showStatus ? <span className="text-muted-foreground"> — {statusText(t.status)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Notes({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className="mt-1">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}

const dash = <span className="text-muted-foreground">—</span>;

/**
 * Read-only morning-plan vs. evening-report comparison for the selected day.
 * Every value comes from the stored reports; missing submissions stay visible.
 */
export function ReportComparison({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[64rem] text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-52 px-4 py-2 font-medium">Employee</th>
            <th className="w-40 px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Morning plan</th>
            <th className="px-3 py-2 font-medium">Completed (evening)</th>
            <th className="px-3 py-2 font-medium">Pending / incomplete</th>
            <th className="px-3 py-2 font-medium">Blockers</th>
          </tr>
        </thead>
        <tbody className="divide-y align-top">
          {rows.map((r) => {
            const c = r.comparison;
            const evening = Boolean(r.eveningSubmittedAt);
            return (
              <tr key={r.userId}>
                <td className="px-4 py-3">
                  <span className="flex items-start gap-2.5">
                    <UserAvatar name={r.name} seed={r.userId} size="sm" />
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {r.name}
                        {r.badge ? (
                          <span className="ml-1.5 rounded bg-zinc-100 px-1.5 py-px text-[11px] font-medium text-zinc-600">{r.badge}</span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted-foreground">{[r.roleLabel, r.team].filter(Boolean).join(" · ")}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="grid justify-items-start gap-1">
                    <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", SUBMISSION_TONE[c.submission])}>{SUBMISSION_LABELS[c.submission]}</span>
                    {c.outcome ? (
                      <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", OUTCOME_TONE[c.outcome])}>
                        {OUTCOME_LABELS[c.outcome]}
                        {c.basedOnPlan ? ` · ${c.plannedCompleted}/${c.planned.length} planned` : ""}
                      </span>
                    ) : null}
                    <span className="text-[11px] text-muted-foreground">
                      {r.morningSubmittedAt ? `Morning ${formatDateTime(r.morningSubmittedAt)}` : "No morning plan"}
                      <br />
                      {r.eveningSubmittedAt ? `Evening ${formatDateTime(r.eveningSubmittedAt)}` : "No evening report"}
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  {r.morningSubmittedAt ? (
                    <>
                      {c.planned.length ? <TaskList tasks={c.planned} showStatus={evening} /> : <p className="text-muted-foreground">No tasks planned</p>}
                      <Notes label="Notes" text={r.morningPlan} />
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className="px-3 py-3">
                  {evening ? (
                    <>
                      <TaskList tasks={c.completed} />
                      {c.outcome === "unknown" ? (
                        <p className="text-muted-foreground">
                          Task details were not recorded for this older report
                          {r.storedCounts
                            ? ` (counts stored with it: ${r.storedCounts.completed} completed, ${r.storedCounts.notCompleted} not completed, ${r.storedCounts.blocked} blocked)`
                            : ""}
                          .
                        </p>
                      ) : null}
                      <Notes label="Accomplishments" text={r.accomplishments} />
                      {!c.completed.length && !r.accomplishments && c.outcome !== "unknown" ? <p className="text-muted-foreground">Nothing completed</p> : null}
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className="px-3 py-3">
                  {evening ? (
                    <>
                      <TaskList tasks={c.pending} showStatus />
                      <Notes label="Why incomplete" text={r.workRemaining} />
                      {!c.pending.length && !r.workRemaining ? dash : null}
                    </>
                  ) : (
                    dash
                  )}
                </td>
                <td className="px-3 py-3">
                  {evening ? (
                    <>
                      <TaskList tasks={c.blocked} />
                      <Notes label="Reported blockers" text={r.blockers} />
                      {!c.blocked.length && !r.blockers ? dash : null}
                    </>
                  ) : (
                    dash
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
