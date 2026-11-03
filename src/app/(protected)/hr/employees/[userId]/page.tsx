import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, Section } from "@/components/app/page-header";
import { HrProfileForm, IdentityForm, PhotoUpload } from "@/components/hr/profile-forms";
import { ProfileView } from "@/components/hr/profile-view";
import { DayTable, LeaveHistoryTable, TotalsGrid } from "@/components/hr/report-views";
import { ROUTE_ROLES } from "@/lib/auth/roles";
import { addMonths, formatMonth } from "@/lib/attendance";
import { BUSINESS_TIMEZONE } from "@/lib/domain";
import { buildMonthReport, parseReportMonth } from "@/lib/data/hr-month";
import { getHrProfile } from "@/lib/data/hr-people";
import { listLeaveForUser } from "@/lib/data/hr";

import { getPageContext } from "../../../_components/context";

export const metadata: Metadata = { title: "Employee profile" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EmployeeDetailPage({ params, searchParams }: PageProps<"/hr/employees/[userId]">) {
  await getPageContext(ROUTE_ROLES["/hr"]);
  const { userId } = await params;
  if (!UUID.test(userId)) notFound();
  const sp = await searchParams;
  const month = parseReportMonth(sp.month);
  const year = Number(month.slice(0, 4));

  const [profile, report, leave] = await Promise.all([
    getHrProfile(userId),
    buildMonthReport(month, { userId }),
    listLeaveForUser(userId, `${year}-01-01`, `${year}-12-31`),
  ]);
  if (!profile) notFound();
  const mine = report.reports[0];
  const link = (m: string) => `/hr/employees/${userId}?month=${m}`;

  return (
    <>
      <PageHeader
        title={profile.employee.name}
        description={`${profile.employee.employeeCode ?? ""} · ${profile.employee.designation ?? "No designation"}`}
        actions={
          <Link href="/hr/employees" className="text-sm underline-offset-4 hover:underline">
            ← All employees
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Profile">
          <ProfileView profile={profile} />
        </Section>
        <div className="grid content-start gap-4">
          <Section title="Edit HR details">
            <HrProfileForm
              userId={userId}
              initial={{
                gender: profile.gender,
                dateOfBirth: profile.dateOfBirth,
                personalEmail: profile.personalEmail,
                phone: profile.phone,
                address: profile.address,
                joiningDate: profile.employee.joiningDate,
                employmentStatus: profile.employee.employmentStatus ?? "ACTIVE",
                employmentType: profile.employee.employmentType ?? "FULL_TIME",
              }}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Name, department, designation and reporting manager are edited on the <Link href="/team" className="underline">Employees</Link> page.
            </p>
          </Section>
          <Section title="Identity">
            <IdentityForm userId={userId} panLast4={profile.panLast4} aadhaarLast4={profile.aadhaarLast4} />
          </Section>
          <Section title="Photo">
            <PhotoUpload userId={userId} />
          </Section>
        </div>
      </div>

      <Section title={`Attendance · ${formatMonth(month)}`} className="mt-4">
        <nav className="mb-3 flex gap-2 text-sm" aria-label="Month">
          <Link href={link(addMonths(month, -1))} className="rounded-md px-2 py-1 hover:bg-muted">← Previous</Link>
          <Link href={link(addMonths(month, 1))} className="rounded-md px-2 py-1 hover:bg-muted">Next →</Link>
        </nav>
        {mine ? (
          <div className="grid gap-4">
            <TotalsGrid totals={mine.totals} />
            <DayTable days={mine.days} timeZone={BUSINESS_TIMEZONE} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No attendance for this month.</p>
        )}
      </Section>

      <Section title={`Leave · ${year}`} className="mt-4">
        <LeaveHistoryTable applications={leave} />
      </Section>
    </>
  );
}
