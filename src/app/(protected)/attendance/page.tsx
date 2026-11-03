import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/app/page-header";
import { UserAvatar } from "@/components/app/user-avatar";
import { HistoryTable, MonthCalendar, WeekList } from "@/components/attendance/attendance-views";
import { CheckInCard } from "@/components/attendance/check-in-card";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { monthRange, parseMonth, summarizeDay, weekDates, type DaySummary } from "@/lib/attendance";
import { getWorkPolicy, listMyAttendance } from "@/lib/data/attendance";
import { listHolidays, listLeaveForUser } from "@/lib/data/hr";
import { approvedLeaveByDate, holidaysByDate } from "@/lib/hr/leave";
import { getMyWorkspaces } from "@/lib/data/workspace";
import { BUSINESS_TIMEZONE, addDaysISO, displayName, formatDate, todayISO } from "@/lib/domain";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: PageProps<"/attendance">) {
  const { session, workspace } = await getPageContext();
  if (!workspace) return <NoWorkspace session={session} />;

  const timeZone = workspace.timezone || BUSINESS_TIMEZONE;
  const now = new Date();
  const today = todayISO(now, timeZone);
  const sp = await searchParams;
  const month = parseMonth(sp.month, today);
  const { first, last } = monthRange(month);
  const week = weekDates(today);
  const from = [first, week[0]!].sort()[0]!;
  const to = [last, week[6]!].sort().at(-1)!;

  const [sessions, workspaces, policy, leave, holidays] = await Promise.all([
    listMyAttendance(session.user.id, from, to),
    getMyWorkspaces(),
    getWorkPolicy(),
    listLeaveForUser(session.user.id, from, to),
    listHolidays(from, to),
  ]);
  // Approved leave, holidays and weekly offs shape days without attendance (034).
  const context = { leave: approvedLeaveByDate(leave), holidays: holidaysByDate(holidays), weeklyOffDays: policy.weeklyOffDays };
  const workspaceNames = new Map(workspaces.map((w) => [w.id, w.name]));

  const dates = new Set([...week, ...sessions.map((s) => s.workDate)]);
  for (let d = first; d <= last; d = addDaysISO(d, 1)) dates.add(d);
  const days = new Map<string, DaySummary>([...dates].map((d) => [d, summarizeDay(d, sessions, today, now, policy, context)]));

  const open = sessions.find((s) => !s.checkOutAt) ?? null;
  const todays = days.get(today)!;
  const monthSessions = sessions.filter((s) => s.workDate >= first && s.workDate <= last);
  const name = displayName({ full_name: session.profile.fullName, email: session.profile.email });
  const profileLine = [session.profile.jobTitle, session.profile.department, session.profile.team].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader title="Attendance" description={`${formatDate(today)} · times in ${timeZone}`} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        <div className="grid min-w-0 gap-4 lg:col-span-2">
          <CheckInCard
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            timeZone={timeZone}
            today={today}
            serverNow={now.toISOString()}
            todaySessions={todays.sessions}
            openSession={open}
            openWorkspaceName={open ? (workspaceNames.get(open.workspaceId) ?? null) : null}
            policy={policy}
          />
          <Section title="This week">
            <WeekList days={week.map((d) => days.get(d)!)} today={today} timeZone={timeZone} />
          </Section>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <section className="flex items-center gap-3 rounded-xl border bg-card p-4" aria-label="Your profile">
            <UserAvatar name={name} seed={session.user.id} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-medium">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{profileLine || ROLE_LABELS[session.profile.role]}</p>
            </div>
          </section>
          <Section title="Shift">
            <p className="text-sm text-muted-foreground">No shift assigned yet.</p>
          </Section>
          <Section title="Calendar">
            <MonthCalendar month={month} days={days} today={today} />
          </Section>
        </div>
      </div>

      <Section title="History" className="mt-4">
        <HistoryTable sessions={monthSessions} days={days} timeZone={timeZone} workspaceNames={workspaceNames} />
      </Section>
    </>
  );
}
