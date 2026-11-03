import type { Metadata } from "next";

import { PageHeader, Section } from "@/components/app/page-header";
import { LeaveApplyForm, MyLeaveTable } from "@/components/hr/leave-components";
import { getLeaveBalance, listLeaveForUser } from "@/lib/data/hr";
import { LEAVE_LABELS } from "@/lib/hr/leave";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Leave applications" };

export default async function MyLeavePage() {
  const { session } = await getPageContext();
  const today = todayISO(new Date(), BUSINESS_TIMEZONE);
  const year = Number(today.slice(0, 4));
  const [balance, applications] = await Promise.all([
    getLeaveBalance(null, year),
    listLeaveForUser(session.user.id, `${year}-01-01`, `${year}-12-31`),
  ]);
  const cl = balance.find((b) => b.type === "CL");

  return (
    <>
      <PageHeader title="Leave applications" description={`${year} · applications are approved by a super admin`} />

      <div className="grid gap-3 sm:grid-cols-3">
        {balance.map((b) => (
          <section key={b.type} className="rounded-xl border bg-card p-4" aria-label={LEAVE_LABELS[b.type]}>
            <p className="text-xs text-muted-foreground">{LEAVE_LABELS[b.type]}</p>
            {b.allowance !== null ? (
              <>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {b.available ?? 0}
                  <span className="text-sm font-normal text-muted-foreground"> / {b.allowance} available</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {b.approved} taken · {b.pending} pending
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{b.approved}</p>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  day{b.approved === 1 ? "" : "s"} approved · {b.pending} pending{b.type === "LWP" ? " · unpaid" : ""}
                </p>
              </>
            )}
          </section>
        ))}
      </div>

      <Section title="Apply" className="mt-4">
        <LeaveApplyForm today={today} clAvailable={cl?.available ?? null} />
      </Section>

      <Section title={`My applications (${year})`} className="mt-4">
        <MyLeaveTable applications={applications} />
      </Section>
    </>
  );
}
