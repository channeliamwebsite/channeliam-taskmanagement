import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { UserAvatar } from "@/components/app/user-avatar";
import { DailyReportForm } from "@/components/reports/daily-report-form";
import { MorningPlanForm } from "@/components/reports/morning-plan-form";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { summarizeDay } from "@/lib/data/daily-summary";
import { isCarriedForward, listTasks } from "@/lib/data/tasks";
import { getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { displayName, formatDate, formatDateTime, PRIORITY_RANK } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { NoWorkspace, getPageContext } from "../_components/context";

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
};

const SELECT =
  "id, user_id, report_date, tasks_completed, tasks_in_progress, tasks_blocked, total_hours, accomplishments, blockers, tomorrow_plan, work_remaining, linked_task_ids, morning_plan, planned_task_ids, morning_submitted_at, evening_submitted_at";

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
  if (mineRes.error || teamRes.error) throw new Error("Failed to load reports");

  const mine = mineRes.data as unknown as ReportRow[];
  const todays = mine.find((r) => r.report_date === today);
  const visibleTasks = canViewTeam ? await listTasks({ workspaceId: workspace.id }) : [...day.completed, ...day.notCompleted, ...day.blocked];
  const titleOf = new Map(visibleTasks.map((t) => [t.id, t.title]));

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
  const myTeam = session.profile.team;
  const roster = members
    .filter((m) => m.isActive)
    .filter(
      (m) =>
        session.profile.role === "SUPER_ADMIN" ||
        m.userId === userId ||
        m.managerId === userId ||
        (myTeam !== null && m.team === myTeam),
    );
  const reportsBy = new Map((teamRes.data as unknown as ReportRow[]).map((r) => [r.user_id, r]));
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
    .sort((a, b) => (a.member.team ?? "~").localeCompare(b.member.team ?? "~") ||
      displayName({ full_name: a.member.fullName, email: a.member.email }).localeCompare(displayName({ full_name: b.member.fullName, email: b.member.email })));
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
                      {displayName({ full_name: m.fullName, email: m.email })}
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
                const name = displayName({ full_name: m.fullName, email: m.email });
                return (
                  <li key={m.userId} className="rounded-xl border bg-card p-4 text-sm">
                    <div className="mb-2 flex items-center gap-2.5">
                      <UserAvatar name={name} seed={m.userId} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{name}</p>
                        <p className="text-xs text-muted-foreground">{[ROLE_LABELS[m.role], m.team].filter(Boolean).join(" · ")}</p>
                      </div>
                      {r ? <span className="text-xs text-muted-foreground">{hours(Number(r.total_hours))}</span> : null}
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Morning plan:{" "}
                      {r?.morning_submitted_at ? `submitted ${formatDateTime(r.morning_submitted_at)}` : "not submitted"} · Evening report:{" "}
                      {r?.evening_submitted_at ? `submitted ${formatDateTime(r.evening_submitted_at)}` : "not submitted"}
                    </p>
                    {r ? (
                      <>
                        {r.evening_submitted_at ? (
                          <p className="mb-2 text-xs text-muted-foreground">
                            {r.tasks_completed} completed · {r.tasks_in_progress} not completed · {r.tasks_blocked} blocked
                          </p>
                        ) : null}
                        {[
                          ["Planned tasks", r.planned_task_ids?.length ? r.planned_task_ids.map((id) => titleOf.get(id) ?? "(task)").join(", ") : null],
                          ["Plan notes", r.morning_plan],
                          ["Accomplishments", r.accomplishments],
                          ["Why incomplete", r.work_remaining],
                          ["Blockers", r.blockers],
                          ["Tomorrow's priorities", r.tomorrow_plan],
                          ["Tasks covered", r.linked_task_ids?.length ? r.linked_task_ids.map((id) => titleOf.get(id) ?? "(task)").join(", ") : null],
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
