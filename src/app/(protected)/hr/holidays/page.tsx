import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Section } from "@/components/app/page-header";
import { HolidayManager } from "@/components/hr/holiday-manager";
import { ROUTE_ROLES } from "@/lib/auth/roles";
import { listHolidays } from "@/lib/data/hr";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Public holidays" };

export default async function HolidaysPage({ searchParams }: PageProps<"/hr/holidays">) {
  // Super admins only (also enforced by RLS on hr_public_holidays).
  await getPageContext(ROUTE_ROLES["/hr"]);
  const sp = await searchParams;
  const today = todayISO(new Date(), BUSINESS_TIMEZONE);
  const year = typeof sp.year === "string" && /^\d{4}$/.test(sp.year) ? Number(sp.year) : Number(today.slice(0, 4));
  const holidays = await listHolidays(`${year}-01-01`, `${year}-12-31`, true);

  return (
    <>
      <PageHeader title="Public holidays" description={`${year} · company-wide, for every active employee`} />
      <nav className="mb-4 flex gap-2 text-sm" aria-label="Year">
        <Link href={`/hr/holidays?year=${year - 1}`} className="rounded-md px-2 py-1.5 hover:bg-muted">
          ← {year - 1}
        </Link>
        <Link href={`/hr/holidays?year=${year + 1}`} className="rounded-md px-2 py-1.5 hover:bg-muted">
          {year + 1} →
        </Link>
      </nav>
      <Section title={`Holidays (${holidays.filter((h) => h.isActive).length})`}>
        <HolidayManager holidays={holidays} defaultDate={year === Number(today.slice(0, 4)) ? today : `${year}-01-01`} />
      </Section>
    </>
  );
}
