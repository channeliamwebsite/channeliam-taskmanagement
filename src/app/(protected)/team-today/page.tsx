import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { MeetingSchedule } from "@/components/meetings/meeting-schedule";
import { TeamTodayPanel } from "@/components/team/team-today-panel";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { ROUTE_ROLES } from "@/lib/auth/roles";
import { listClientOptions } from "@/lib/data/clients";
import { listHolidays } from "@/lib/data/hr";
import { listMeetingRecords } from "@/lib/data/meeting-records";
import { listMeetingLinks } from "@/lib/data/meetings";
import { getTaskTitles, listTasks } from "@/lib/data/tasks";
import { listProjectOptions } from "@/lib/data/projects";
import { loadTeamToday } from "@/lib/data/team-today-data";
import { displayName, formatDate, isWorkingDay } from "@/lib/domain";
import { workspaceToday } from "@/lib/data/workspace";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Team Today" };

export default async function TeamTodayPage() {
  const { session, workspace } = await getPageContext(ROUTE_ROLES["/team-today"]);
  if (!workspace) return <NoWorkspace session={session} />;

  // Super admins have no My Day, so today's meetings live here (decided
  // 2026-11-06): recurring daily links plus meetings dated today, shown only on
  // working days (not weekly offs or public holidays).
  const isSuperAdmin = session.profile.role === "SUPER_ADMIN";
  const today = workspaceToday(workspace);
  const [data, projects, clientOptions, meetingLinks, holidays, meetingRecords, openTasks] = await Promise.all([
    loadTeamToday(session, workspace),
    listProjectOptions(workspace.id),
    listClientOptions(workspace.id),
    isSuperAdmin ? listMeetingLinks(workspace.id, { activeOnly: true }) : Promise.resolve([]),
    isSuperAdmin ? listHolidays(today, today) : Promise.resolve([]),
    isSuperAdmin ? listMeetingRecords(workspace.id, today, today) : Promise.resolve({ available: false, records: [] }),
    // Follow-up task picker for meeting notes: open tasks only (same result as
    // the previous fetch-everything-then-filter-to-open, just scoped in the query).
    isSuperAdmin ? listTasks({ workspaceId: workspace.id, openOnly: true }) : Promise.resolve([]),
  ]);
  const workingDay = isWorkingDay(today) && holidays.length === 0;
  const taskOptions = openTasks
    .map((t) => ({ id: t.id, title: t.title }))
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 300);
  // Titles for already-recorded follow-up tasks (today's meeting records only),
  // which may include tasks completed since — looked up by id instead of
  // pulling in every task in the workspace just for their titles.
  const followUpIds = [...new Set(meetingRecords.records.flatMap((r) => r.followUpTaskIds))];
  const taskTitles = followUpIds.length ? await getTaskTitles(followUpIds) : new Map<string, string>();
  const memberOptions = data.members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
    team: m.team,
  }));

  return (
    <>
      <PageHeader
        title="Team Today"
        description={`${formatDate(data.today)} · ${session.profile.role === "SUPER_ADMIN" ? "everyone in" : "your team in"} ${workspace.name}`}
        actions={
          session.permissions.createTasks ? (
            <NewTaskButton projects={projects} clients={clientOptions} members={memberOptions} workspaceId={workspace.id} label="Assign task" />
          ) : null
        }
      />
      {isSuperAdmin && workingDay ? (
        <div className="mb-6">
          <MeetingSchedule
            title="Today's meetings"
            workspaceId={workspace.id}
            meetings={meetingLinks}
            meetingRecords={meetingRecords}
            days={[today]}
            today={today}
            taskOptions={taskOptions}
            taskTitles={taskTitles}
          />
        </div>
      ) : null}
      <TeamTodayPanel rows={data.rows} tasksByUser={data.tasksByUser} totals={data.totals} today={data.today} />
    </>
  );
}
