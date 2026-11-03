import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, Section } from "@/components/app/page-header";
import { LeaveReviewTable, type ReviewRow } from "@/components/hr/leave-components";
import { ROUTE_ROLES } from "@/lib/auth/roles";
import { getLeaveBalance, listLeaveForReview } from "@/lib/data/hr";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Leave approvals" };

const FILTERS = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "ALL", label: "All" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

export default async function LeaveReviewPage({ searchParams }: PageProps<"/hr/leave">) {
  // Super admins only (also enforced by RLS and hr_decide_leave).
  const { session } = await getPageContext(ROUTE_ROLES["/hr"]);
  const sp = await searchParams;
  const filter: Filter = FILTERS.some((f) => f.key === sp.status) ? (sp.status as Filter) : "PENDING";
  const today = todayISO(new Date(), BUSINESS_TIMEZONE);
  const thisYear = Number(today.slice(0, 4));
  const year = typeof sp.year === "string" && /^\d{4}$/.test(sp.year) ? Number(sp.year) : thisYear;

  const apps = await listLeaveForReview(filter, year);
  // CL left per applicant (only for those with CL applications in view).
  const clByUser = new Map<string, number | null>();
  await Promise.all(
    [...new Set(apps.filter((a) => a.type === "CL").map((a) => a.userId))].map(async (userId) => {
      const balance = await getLeaveBalance(userId, year);
      clByUser.set(userId, balance.find((b) => b.type === "CL")?.available ?? null);
    }),
  );
  const rows: ReviewRow[] = apps.map((a) => ({ ...a, clAvailable: clByUser.get(a.userId) ?? null }));

  const href = (status: Filter) => `/hr/leave?status=${status}${year !== thisYear ? `&year=${year}` : ""}`;
  return (
    <>
      <PageHeader title="Leave applications" description={`${year} · approve or reject. Nobody decides their own application.`} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter applications">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href(f.key)}
            aria-current={filter === f.key ? "page" : undefined}
            className={cn("rounded-md border px-3 py-1.5 text-sm", filter === f.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {f.label}
          </Link>
        ))}
        <span className="ml-auto flex gap-2 text-sm">
          <Link href={`/hr/leave?status=${filter}&year=${year - 1}`} className="rounded-md px-2 py-1.5 hover:bg-muted">
            ← {year - 1}
          </Link>
          {year < thisYear + 1 ? (
            <Link href={`/hr/leave?status=${filter}&year=${year + 1}`} className="rounded-md px-2 py-1.5 hover:bg-muted">
              {year + 1} →
            </Link>
          ) : null}
        </span>
      </nav>
      <Section title={`${FILTERS.find((f) => f.key === filter)!.label} (${rows.length})`}>
        <LeaveReviewTable rows={rows} currentUserId={session.user.id} />
      </Section>
    </>
  );
}
