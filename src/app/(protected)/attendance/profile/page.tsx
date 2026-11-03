import type { Metadata } from "next";

import { EmptyState, PageHeader, Section } from "@/components/app/page-header";
import { ProfileView } from "@/components/hr/profile-view";
import { getHrProfile } from "@/lib/data/hr-people";
import { UserRound } from "lucide-react";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const { session } = await getPageContext();
  // RLS returns only the caller's own HR profile; identity values come masked.
  const profile = await getHrProfile(session.user.id);
  return (
    <>
      <PageHeader title="My profile" description="Your HR details. Contact a super admin to change them." />
      <Section title="Profile">
        {profile ? (
          <ProfileView profile={profile} />
        ) : (
          <EmptyState icon={UserRound} title="No HR profile yet" description="A super admin sets up HR profiles." />
        )}
      </Section>
    </>
  );
}
