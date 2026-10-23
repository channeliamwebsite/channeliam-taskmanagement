import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { UserAvatar } from "@/components/app/user-avatar";
import { DailyReportForm } from "@/components/reports/daily-report-form";
import { MorningPlanForm } from "@/components/reports/morning-plan-form";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { summarizeDay } from "@/lib/data/daily-summary";
import { getTaskTitles, isCarriedForward } from "@/lib/data/tasks";
import { getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { displayName, formatDate, formatDateTime, isTaskStatus, PRIORITY_RANK, TASK_STATUS_LABELS } from "@/lib/domain";
import { buildReportRoster, readEveningSnapshot, reportTaskLabel, updatedAfterSubmission } from "@/lib/report-history";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";
import { loadError } from "@/lib/data/errors";

export const metadata: Metadata = { title: "Daily Updates" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = {
  "": "Any status",
  morning_missing: "Morning plan missing",
  evening_missing: "Evening report missing",
  complete: "Both submitted",
  none: "Nothing submitted",
} as const;

type ReportRow = {
  id: string;
  user_id: string;
  report_date: string;
  tasks_completed: number;
  tasks_in_progress: number;
  tasks_blocked: number;
  total_hours: number;
  accomplishments: string | null;
  blockers: string | null;
  tomorrow_plan: string | null;
  work_remaining: string | null;
  linked_task_ids: string[];
  morning_plan: string | null;
  planned_task_ids: string[];
  morning_submitted_at: string | null;
  evening_submitted_at: string | null;
  updated_at: string;
  /** Server-built at evening submission (migration 009); null for older reports. */
  evening_snapshot: unknown;
  /** Department at the first submission that day (migration 009); null for older reports. */
  reporter_team: string | null;
};

const SELECT =
  "id, user_id, report_date, tasks_completed, tasks_in_progress, tasks_blocked, total_hours, accomplishments, blockers, tomorrow_plan, work_remaining, linked_task_ids, morning_plan, planned_task_ids, morning_submitted_at, evening_submitted_at, updated_at, evening_snapshot, reporter_team";

function hours(n: number) {
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

const selectClass = "h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground";

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = workspaceToday(workspace);
  const date = DATE_RE.test(get("date")) && get("date") <= today ? get("date") : today;
  const department = get("department");
  const employee = UUID.test(get("employee")) ? get("employee") : "";
  const status = (get("status") in STATUSES ? get("status") : "") as keyof typeof STATUSES;
  const canViewTeam = session.permissions.viewTeamReports;
  const userId = session.user.id;
  const supabase = await createClient();

  const [mineRes, teamRes, day, members] = await Promise.all([
    supabase.from("daily_reports").select(SELECT).eq("workspace_id", workspace.id).eq("user_id", userId)
      .order("report_date", { ascending: false }).limit(10),
    canViewTeam
      ? supabase.from("daily_reports").select(SELECT).eq("workspace_id", workspace.id).eq("report_date", date)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    summarizeDay(workspace.id, userId, today, workspace.timezone),
    canViewTeam ? getWorkspaceMembers(workspace.id) : Promise.resolve([]),
  ]);
  if (mineRes.error || teamRes.error) throw loadError("Failed to load reports", mineRes.error ?? teamRes.error);

  const mine = mineRes.data as unknown as ReportRow[];
  const todays = mine.find((r) => r.report_date === today);
  // Titles for the tasks the shown reports refer to — fetched by id (RLS-scoped)
  // rather than loading every task in the workspace.
  const reportedIds = canViewTeam
    ? (teamRes.data as unknown as ReportRow[]).flatMap((r) => [...(r.planned_task_ids ?? []), ...(r.linked_task_ids ?? [])])
    : [];
  const titleOf = new Map([
    ...[...day.completed, ...day.notCompleted, ...day.blocked].map((t) => [t.id, t.title] as const),
    ...(await getTaskTitles(reportedIds)),
  ]);

  const planned = [...day.notCompleted, ...day.blocked]
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .map((t) => ({
      id: t.id,
      title: t.title,
      where: [t.clientName, t.projectName].filter(Boolean).join(" · "),
      priority: t.priority,
      carried: isCarriedForward(t, today),
    }));

  const initial = {
    totalHours: todays && Number(todays.total_hours) > 0 ? String(todays.total_hours) : "",
    accomplishments: todays?.accomplishments ?? "",
    workRemaining: todays?.work_remaining ?? "",
    blockers: todays?.blockers ?? "",
    tomorrowPlan: todays?.tomorrow_plan ?? "",
  };
  const ref = (list: { id: string; title: string }[]) => list.map((t) => ({ id: t.id, title: t.title }));

  // Team roster: super admins see everyone; admins see themselves, their direct
  // reports and their own department (RLS lets admins read workspace reports).
  // Deactivated or removed employees stay listed for dates they reported on.
  const teamReports = teamRes.data as unknown as ReportRow[];
  const reportsBy = new Map(teamReports.map((r) => [r.user_id, r]));
  const rosterEntries = buildReportRoster(members, reportsBy.keys(), {
    userId,
    role: session.profile.role,
    team: session.profile.team,
  });
  // People no longer in the workspace: their profile is shown only if RLS still allows it.
  const removedIds = rosterEntries.filter((e) => e.state === "removed").map((e) => e.userId);
  const formerProfiles = new Map(
    removedIds.length
      ? ((await supabase.from("profiles").select("id, full_name, email, team").in("id", removedIds)).data ?? []).map((p) => [p.id, p])
      : [],
  );
  const roster = rosterEntries.map((e) => {
    const former = formerProfiles.get(e.userId);
    const name = e.member
      ? displayName({ full_name: e.member.fullName, email: e.member.email })
      : former
        ? displayName({ full_name: former.full_name, email: former.email })
        : "Former member";
    const team = e.member ? e.member.team : (former?.team ?? null);
    const badge = e.state === "inactive" ? "Inactive" : e.state === "removed" ? "Former member" : null;
    const roleLabel = e.member ? ROLE_LABELS[e.member.role] : null;
    return { userId: e.userId, name, team, badge, roleLabel };
  });
  const departments = [...new Set(roster.map((m) => m.team).filter((t): t is string => Boolean(t)))].sort();
  const rows = roster
    .filter((m) => !department || (department === "__none__" ? !m.team : m.team === department))
    .filter((m) => !employee || m.userId === employee)
    .map((m) => ({ member: m, report: reportsBy.get(m.userId) ?? null }))
    .filter(({ report }) => {
      const am = Boolean(report?.morning_submitted_at);
      const pm = Boolean(report?.evening_submitted_at);
      if (status === "morning_missing") return !am;
      if (status === "evening_missing") return !pm;
      if (status === "complete") return am && pm;
      if (status === "none") return !am && !pm;
      return true;
    })
    .sort((a, b) => (a.member.team ?? "~").localeCompare(b.member.team ?? "~") || a.member.name.localeCompare(b.member.name));
  // A super admin can read every task in the workspace, so an unresolvable id means a deleted task.
  const taskLabel = (id: string) => reportTaskLabel(id, titleOf, session.profile.role === "SUPER_ADMIN");
  const morningCount = rows.filter((r) => r.report?.morning_submitted_at).length;
  const eveningCount = rows.filter((r) => r.report?.evening_submitted_at).length;

  return (
    <>
      <PageHeader title="Daily Updates" description="Morning plan and evening report. Task details come from your tasks." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Section title={`Morning plan · ${formatDate(today)}`}>
            <MorningPlanForm
              workspaceId={workspace.id}
              tasks={planned}
              initialNotes={todays?.morning_plan ?? ""}
              submittedAt={todays?.morning_submitted_at ?? null}
              updatedAt={todays?.updated_at ?? null}
            />
          </Section>
          <Section title={`Evening report · ${formatDate(today)}`}>
            <DailyReportForm
              workspaceId={workspace.id}
              initial={initial}
              isUpdate={Boolean(todays?.evening_submitted_at)}
              completed={ref(day.completed)}
              notCompleted={ref(day.notCompleted)}
              blocked={ref(day.blocked)}
            />
          </Section>
        </div>
        <Section title="Your recent reports">
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground">You haven&apos;t submitted a report yet.</p>
          ) : (
            <ul className="-my-2 divide-y">
              {mine.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{formatDate(r.report_date)}</span>
                    <span className="text-muted-foreground">{hours(Number(r.total_hours))}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Morning {r.morning_submitted_at ? "✓" : "—"} · Evening {r.evening_submitted_at ? "✓" : "—"} ·{" "}
                    {r.tasks_completed} done · {r.tasks_in_progress} not completed
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {canViewTeam ? (
        <div className="mt-6 grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{session.profile.role === "SUPER_ADMIN" ? "Organisation updates" : "Team updates"}</h2>
              <p className="text-sm text-muted-foreground">
                {formatDate(date)} · {rows.length} employee{rows.length === 1 ? "" : "s"} · morning plans {morningCount} · evening reports {eveningCount}
              </p>
            </div>
            <form className="flex flex-wrap items-end gap-2" action="/reports">
              <label className="grid gap-1 text-xs text-muted-foreground">
                Date
                <input type="date" name="date" defaultValue={date} max={today} className={cn(selectClass, "px-2.5")} />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Department
                <select name="department" defaultValue={department} className={selectClass}>
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                  <option value="__none__">No department</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Employee
                <select name="employee" defaultValue={employee} className={selectClass}>
                  <option value="">All employees</option>
                  {roster.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.badge ? `${m.name} (${m.badge.toLowerCase()})` : m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Submission
                <select name="status" defaultValue={status} className={selectClass}>
                  {Object.entries(STATUSES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">
                Apply
              </button>
              <Link href="/reports" className="h-9 px-2 text-sm leading-9 text-muted-foreground hover:underline">
                Clear
              </Link>
            </form>
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={FileText} title="No employees match these filters" />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows.map(({ member: m, report: r }) => {
                const name = m.name;
                // Evening reports submitted through submit_evening_report carry a snapshot of the
                // tasks as they were then; older reports fall back to today's titles.
                const snapshot = r ? readEveningSnapshot(r.evening_snapshot) : null;
                const covered = snapshot
                  ? snapshot.tasks
                      .map((t) => `${t.title} (${isTaskStatus(t.status) ? TASK_STATUS_LABELS[t.status] : t.status})`)
                      .join(", ")
                  : r?.linked_task_ids?.length
                    ? r.linked_task_ids.map(taskLabel).join(", ")
                    : null;
                const teamAtSubmission = r?.reporter_team && r.reporter_team !== m.team ? r.reporter_team : null;
                return (
                  <li key={m.userId} className="rounded-xl border bg-card p-4 text-sm">
                    <div className="mb-2 flex items-center gap-2.5">
                      <UserAvatar name={name} seed={m.userId} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate font-medium">
                          {name}
                          {m.badge ? (
                            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">{m.badge}</span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">{[m.roleLabel, m.team].filter(Boolean).join(" · ")}</p>
                        {teamAtSubmission ? (
                          <p className="text-xs text-muted-foreground">Department when submitted: {teamAtSubmission}</p>
                        ) : null}
                      </div>
                      {r ? <span className="text-xs text-muted-foreground">{hours(Number(r.total_hours))}</span> : null}
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Morning plan:{" "}
                      {r?.morning_submitted_at ? `first submitted ${formatDateTime(r.morning_submitted_at)}` : "not submitted"} · Evening report:{" "}
                      {r?.evening_submitted_at ? `first submitted ${formatDateTime(r.evening_submitted_at)}` : "not submitted"}
                      {r && updatedAfterSubmission(r.updated_at, r.morning_submitted_at, r.evening_submitted_at)
                        ? ` · last updated ${formatDateTime(r.updated_at)} (latest content shown)`
                        : ""}
                    </p>
                    {r ? (
                      <>
                        {r.evening_submitted_at ? (
                          <p className="mb-2 text-xs text-muted-foreground">
                            {r.tasks_completed} completed · {r.tasks_in_progress} not completed · {r.tasks_blocked} blocked
                          </p>
                        ) : null}
                        {[
                          ["Planned tasks", r.planned_task_ids?.length ? r.planned_task_ids.map(taskLabel).join(", ") : null],
                          ["Plan notes", r.morning_plan],
                          ["Accomplishments", r.accomplishments],
                          ["Why incomplete", r.work_remaining],
                          ["Blockers", r.blockers],
                          ["Tomorrow's priorities", r.tomorrow_plan],
                          [snapshot ? "Tasks covered (as submitted)" : "Tasks covered", covered],
                        ].map(([label, text]) =>
                          text ? (
                            <div key={label} className="mt-2">
                              <p className="text-xs font-medium text-muted-foreground">{label}</p>
                              <p className="whitespace-pre-wrap break-words">{text}</p>
                            </div>
                          ) : null,
                        )}
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          Your reports are visible to admins in this workspace. <Link href="/tasks" className="underline">View your tasks</Link>
        </p>
      )}
    </>
  );
}
