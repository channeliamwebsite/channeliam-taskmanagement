import "server-only";

import { BUSINESS_TIMEZONE } from "@/lib/domain";
import type { ExportInput } from "@/lib/hr/export";
import type { ReportScope } from "@/lib/hr/report-scope";
import { createClient } from "@/lib/supabase/server";

import { buildMonthReport } from "./hr-month";
import { getLeaveBalance } from "./hr";

/** Everything the workbook needs for a resolved scope (still RLS-limited to what the caller may see). */
export async function loadExportInput(scope: ReportScope): Promise<ExportInput> {
  const { month, dates, reports } = await buildMonthReport(scope.month, { userId: scope.userId, department: scope.department });
  const year = Number(month.slice(0, 4));

  const clBalances = new Map<string, { allowance: number | null; approved: number; pending: number }>();
  const ids = reports.map((r) => r.employee.userId);
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const rows = await Promise.all(chunk.map((id) => getLeaveBalance(id, year)));
    chunk.forEach((id, j) => {
      const cl = rows[j].find((b) => b.type === "CL");
      if (cl) clBalances.set(id, { allowance: cl.allowance, approved: cl.approved, pending: cl.pending });
    });
  }

  const names = new Map(reports.map((r) => [r.employee.userId, r.employee.name]));
  const approvers = [...new Set(reports.flatMap((r) => r.applications.map((a) => a.decidedBy)).filter((v): v is string => !!v && !names.has(v)))];
  if (approvers.length) {
    const supabase = await createClient();
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", approvers);
    for (const p of data ?? []) names.set(p.id, p.full_name || p.email || "Super admin");
  }

  return { month, dates, timeZone: BUSINESS_TIMEZONE, reports, clBalances, names };
}
