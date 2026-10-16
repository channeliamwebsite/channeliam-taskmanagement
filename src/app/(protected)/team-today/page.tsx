import type { Metadata } from "next";

import { PageHeader } from "@/components/app/page-header";
import { TeamTodayPanel } from "@/components/team/team-today-panel";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { ROUTE_ROLES } from "@/lib/auth/roles";
import { listProjectOptions } from "@/lib/data/projects";
import { loadTeamToday } from "@/lib/data/team-today-data";
import { displayName, formatDate } from "@/lib/domain";

import { NoWorkspace, getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Team Today" };

export default async function TeamTodayPage() {
  const { session, workspace } = await getPageContext(ROUTE_ROLES["/team-today"]);
  if (!workspace) return <NoWorkspace session={session} />;

  const [data, projects] = await Promise.all([loadTeamToday(session, workspace), listProjectOptions(workspace.id)]);
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
        actions={<NewTaskButton projects={projects} members={memberOptions} workspaceId={workspace.id} label="Assign task" />}
      />
      <TeamTodayPanel rows={data.rows} tasksByUser={data.tasksByUser} totals={data.totals} today={data.today} />
    </>
  );
}
