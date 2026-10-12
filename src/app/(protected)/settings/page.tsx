import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/app/page-header";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { CreateWorkspaceForm } from "@/components/settings/create-workspace-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { TimezoneForm } from "@/components/settings/timezone-form";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { MeetingLinksManager } from "@/components/settings/meeting-links-manager";
import { listMeetingLinks } from "@/lib/data/meetings";
import { getMyWorkspaces, getWorkspaceMembers } from "@/lib/data/workspace";

import { getPageContext } from "../_components/context";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { session, workspace } = await getPageContext();
  const { profile } = session;
  const isSuperAdmin = profile.role === "SUPER_ADMIN";
  const [workspaces, meetings, members] = await Promise.all([
    getMyWorkspaces(),
    isSuperAdmin && workspace ? listMeetingLinks(workspace.id) : Promise.resolve([]),
    isSuperAdmin && workspace ? getWorkspaceMembers(workspace.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Settings" description="Your profile and workspace preferences." />
      <div className="grid max-w-3xl gap-6">
        <Section title="Profile">
          <ProfileForm fullName={profile.fullName ?? ""} />
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{profile.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{ROLE_LABELS[profile.role]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Department</dt>
              <dd>{profile.department ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Job title</dt>
              <dd>{profile.jobTitle ?? "—"}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Role, department and job title are managed by a super admin.</p>
        </Section>

        <Section title="Workspaces">
          {workspaces.length ? (
            <ul className="grid gap-1 text-sm">
              {workspaces.map((w) => (
                <li key={w.id} className="flex items-center justify-between">
                  <span>{w.name}</span>
                  {w.id === workspace?.id ? <span className="text-xs text-muted-foreground">Current</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">You don&apos;t belong to any workspace yet.</p>
          )}
          {workspace ? (
            <div className="mt-4 border-t pt-4">
              <p className="mb-2 text-sm font-medium">{workspace.name} settings</p>
              {profile.role === "SUPER_ADMIN" ? (
                <TimezoneForm workspaceId={workspace.id} timezone={workspace.timezone} />
              ) : (
                <p className="text-sm text-muted-foreground">Timezone: {workspace.timezone}</p>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">Used for “today”, My Day and carry-forward.</p>
            </div>
          ) : null}
          {profile.role === "SUPER_ADMIN" ? (
            <div className="mt-4 border-t pt-4">
              <p className="mb-2 text-sm font-medium">Create a workspace</p>
              <CreateWorkspaceForm />
            </div>
          ) : null}
        </Section>

        {isSuperAdmin && workspace ? (
          <div id="meetings" className="scroll-mt-20">
            <Section title="Meeting links">
              <MeetingLinksManager
                workspaceId={workspace.id}
                links={meetings}
                memberTeams={[...new Set(members.map((m) => m.team).filter((t): t is string => Boolean(t)))]}
              />
            </Section>
          </div>
        ) : null}

        <Section title="Session">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Sign out of this device.</p>
            <SignOutButton />
          </div>
        </Section>
      </div>
    </>
  );
}
