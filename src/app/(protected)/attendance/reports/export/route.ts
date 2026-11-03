import type { NextRequest } from "next/server";

import { getCurrentProfile, getCurrentUser } from "@/lib/auth/dal";
import { loadExportInput } from "@/lib/data/hr-export";
import { BUSINESS_TIMEZONE, todayISO } from "@/lib/domain";
import { buildAttendanceWorkbook } from "@/lib/hr/export";
import { resolveReportScope } from "@/lib/hr/report-scope";

// Monthly attendance workbook. Super admins: company-wide, or filtered by
// employee and department. Everyone else: their own report only, whatever
// they pass (and RLS returns only their own rows anyway).
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;
  if (!user || !profile) return new Response("Sign in to download reports.", { status: 401 });
  if (!profile.isActive) return new Response("This account is deactivated.", { status: 403 });

  const sp = request.nextUrl.searchParams;
  const scope = resolveReportScope(
    { userId: user.id, role: profile.role },
    { month: sp.get("month") ?? undefined, year: sp.get("year") ?? undefined, employee: sp.get("employee") ?? undefined, department: sp.get("department") ?? undefined },
    todayISO(new Date(), BUSINESS_TIMEZONE).slice(0, 7),
  );

  try {
    const input = await loadExportInput(scope);
    const body = await buildAttendanceWorkbook(input);
    const who = scope.companyWide ? (scope.department ? `-${scope.department.replace(/[^A-Za-z0-9]+/g, "-")}` : "") : `-${input.reports[0]?.employee.employeeCode ?? "employee"}`;
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="attendance-${scope.month}${who}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("attendance export failed", error instanceof Error ? error.message : error);
    return new Response("The report could not be generated. Try again.", { status: 500 });
  }
}
