import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { UserAvatar } from "@/components/app/user-avatar";
import { DailyReportForm } from "@/components/reports/daily-report-form";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { listTasks } from "@/lib/data/tasks";
import { summarizeDay } from "@/lib/data/daily-summary";
import { getWorkspaceMembers, workspaceToday } from "@/lib/data/workspace";
import { displayName, formatDate } from "@/lib/domain";
import { createClient } from "@/lib/supabase/server";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Daily Updates" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  author: { full_name: string | null; email: string | null; role: "SUPER_ADMIN" | "ADMIN" | "INDIVIDUAL" } | null;
};

const SELECT =
  "id, user_id, report_date, tasks_completed, tasks_in_progress, tasks_blocked, total_hours, accomplishments, blockers, tomorrow_plan, work_remaining, linked_task_ids, author:profiles!daily_reports_user_id_fkey(full_name, email, role)";

function hours(n: number) {
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const sp = await searchParams;
  const today = workspaceToday(workspace);
  const date = typeof sp.date === "string" && DATE_RE.test(sp.date) && sp.date <= today ? sp.date : today;
  const canViewTeam = session.permissions.viewTeamReports;
  const teamOnly = sp.team === "mine";
  const userId = session.user.id;
  const supabase = await createClient();

  const [mineRes, teamRes, day, members] = await Promise.all([
    supabase
      .from("daily_reports")
      .select(SELECT)
      .eq("workspace_id", workspace.id)
      .eq("user_id", userId)
      .order("report_date", { ascending: false })
      .limit(10),
    canViewTeam
      ? supabase.from("daily_reports").select(SELECT).eq("workspace_id", workspace.id).eq("report_date", date)
      : Promise.resolve({ data: [] as unknown[], error: null }),
    summarizeDay(workspace.id, userId, today, workspace.timezone),
    canViewTeam ? getWorkspaceMembers(workspace.id) : Promise.resolve([]),
  ]);
  if (mineRes.error || teamRes.error) throw new Error("Failed to load reports");

  const mine = mineRes.data as unknown as ReportRow[];
  const directReports = new Set(members.filter((m) => m.managerId === userId).map((m) => m.userId));
  const visibleTasks = canViewTeam ? await listTasks({ workspaceId: workspace.id }) : [...day.completed, ...day.notCompleted, ...day.blocked];
  const titleOf = new Map(visibleTasks.map((t) => [t.id, t.title]));
  const team = (teamRes.data as unknown as ReportRow[]).filter((r) => !teamOnly || directReports.has(r.user_id)).sort((a, b) =>
    displayName(a.author).localeCompare(displayName(b.author)),
  );
  const todays = mine.find((r) => r.report_date === today);

  const initial = {
    totalHours: todays && Number(todays.total_hours) > 0 ? String(todays.total_hours) : "",
    accomplishments: todays?.accomplishments ?? "",
    workRemaining: todays?.work_remaining ?? "",
    blockers: todays?.blockers ?? "",
    tomorrowPlan: todays?.tomorrow_plan ?? "",
  };
  const ref = (list: { id: string; title: string }[]) => list.map((t) => ({ id: t.id, title: t.title }));
  const submitted = new Set(team.map((r) => r.user_id));
  const missing = members.filter((m) => m.isActive && !submitted.has(m.userId) && (!teamOnly || directReports.has(m.userId)));
  const totals = team.reduce(
    (acc, r) => ({
      completed: acc.completed + r.tasks_completed,
      inProgress: acc.inProgress + r.tasks_in_progress,
      blocked: acc.blocked + r.tasks_blocked,
      hours: acc.hours + Number(r.total_hours),
    }),
    { completed: 0, inProgress: 0, blocked: 0, hours: 0 },
  );

  return (
    <>
      <PageHeader title="Daily Updates" description="End-of-day updates. Task counts are derived from real task data." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Section title={`Your daily update · ${formatDate(today)}`}>
          <DailyReportForm
            workspaceId={workspace.id}
            initial={initial}
            isUpdate={Boolean(todays)}
            completed={ref(day.completed)}
            notCompleted={ref(day.notCompleted)}
            blocked={ref(day.blocked)}
          />        </Section>
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
                    {r.tasks_completed} done · {r.tasks_in_progress} not completed · {r.tasks_blocked} blocked
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
                {team.length} of {teamOnly ? directReports.size : members.filter((m) => m.isActive).length} {teamOnly ? "direct reports" : "members"} reported on {formatDate(date)}
              </p>
            </div>
            <form className="flex flex-wrap items-end gap-2" action="/reports">
              <label className="grid gap-1 text-xs text-muted-foreground">
                Show
                <select name="team" defaultValue={teamOnly ? "mine" : ""} className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground">
                  <option value="">Everyone</option>
                  <option value="mine">My team</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Date
                <input
                  type="date"
                  name="date"
                  defaultValue={date}
                  max={today}
                  className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground"
                />
              </label>
              <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">
                Show
              </button>
            </form>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Completed", totals.completed],
              ["Not completed", totals.inProgress],
              ["Blocked", totals.blocked],
              ["Hours", hours(totals.hours)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card p-3.5">
                <p className="text-xl font-semibold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {team.length === 0 ? (
            <EmptyState icon={FileText} title="No reports for this date" description="Reports appear here once team members submit them." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {team.map((r) => {
                const name = displayName(r.author);
                return (
                  <li key={r.id} className="rounded-xl border bg-card p-4 text-sm">
                    <div className="mb-2 flex items-center gap-2.5">
                      <UserAvatar name={name} seed={r.user_id} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{name}</p>
                        <p className="text-xs text-muted-foreground">{r.author ? ROLE_LABELS[r.author.role] : ""}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">{hours(Number(r.total_hours))}</span>
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {r.tasks_completed} completed · {r.tasks_in_progress} not completed · {r.tasks_blocked} blocked
                    </p>
                    {[
                      ["Accomplishments", r.accomplishments],
                      ["Why incomplete", r.work_remaining],
                      ["Blockers", r.blockers],
                      ["Tomorrow's priorities", r.tomorrow_plan],
                      ["Linked tasks", r.linked_task_ids?.length ? r.linked_task_ids.map((id) => titleOf.get(id) ?? "(task)").join(", ") : null],
                    ].map(([label, text]) =>
                      text ? (
                        <div key={label} className="mt-2">
                          <p className="text-xs font-medium text-muted-foreground">{label}</p>
                          <p className="whitespace-pre-wrap break-words">{text}</p>
                        </div>
                      ) : null,
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {missing.length ? (
            <p className="text-sm text-muted-foreground">
              Not yet reported:{" "}
              {missing.map((m, i) => (
                <span key={m.userId}>
                  {i ? ", " : ""}
                  {displayName({ full_name: m.fullName, email: m.email })}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          Your reports are visible to admins in this workspace. <Link href="/tasks" className="underline">View your tasks</Link>
        </p>
      )}
    </>
  );
}
