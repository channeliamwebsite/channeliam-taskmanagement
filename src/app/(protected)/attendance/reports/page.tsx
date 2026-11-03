import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Section } from "@/components/app/page-header";
import { DayTable, LeaveHistoryTable, TotalsGrid } from "@/components/hr/report-views";
import { addMonths, formatMonth } from "@/lib/attendance";
import { buildMonthReport, parseReportMonth } from "@/lib/data/hr-month";
import { BUSINESS_TIMEZONE } from "@/lib/domain";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "My reports" };

export default async function MyReportsPage({ searchParams }: PageProps<"/attendance/reports">) {
  const { session } = await getPageContext();
  const month = parseReportMonth((await searchParams).month);
  // Always the caller's own report, for every role.
  const { reports } = await buildMonthReport(month, { userId: session.user.id });
  const mine = reports[0];

  return (
    <>
      <PageHeader
        title="My reports"
        description={`Your attendance for ${formatMonth(month)}.`}
        actions={
          <a
            href={`/attendance/reports/export?month=${month}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            download
          >
            <Download className="size-4" aria-hidden="true" />
            Download Excel
          </a>
        }
      />
      <nav className="mb-3 flex gap-2 text-sm" aria-label="Month">
        <Link href={`/attendance/reports?month=${addMonths(month, -1)}`} className="rounded-md px-2 py-1 hover:bg-muted">← Previous</Link>
        <Link href={`/attendance/reports?month=${addMonths(month, 1)}`} className="rounded-md px-2 py-1 hover:bg-muted">Next →</Link>
      </nav>
      {mine ? (
        <div className="grid gap-4">
          <TotalsGrid totals={mine.totals} />
          <Section title="Daily attendance">
            <DayTable days={mine.days} timeZone={BUSINESS_TIMEZONE} />
          </Section>
          <Section title="Leave this month">
            <LeaveHistoryTable applications={mine.applications} />
          </Section>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No report for this month.</p>
      )}
    </>
  );
}
