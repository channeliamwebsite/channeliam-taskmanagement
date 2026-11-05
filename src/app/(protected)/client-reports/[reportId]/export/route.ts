import type { NextRequest } from "next/server";

import { getCurrentProfile, getCurrentUser } from "@/lib/auth/dal";
import { buildClientReportWorkbook } from "@/lib/client-reports/excel";
import { buildClientReportPdf } from "@/lib/client-reports/pdf";
import { reportFileName } from "@/lib/client-reports/snapshot";
import { getClientReportDocument } from "@/lib/data/client-reports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PDF or Excel of one generated client report, rendered from its frozen
// snapshot. Super admins and the client's workspace admins only (role check
// here; RLS on client_reports decides which reports are visible).
export async function GET(request: NextRequest, ctx: RouteContext<"/client-reports/[reportId]/export">) {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;
  if (!user || !profile) return new Response("Sign in to download reports.", { status: 401 });
  if (!profile.isActive) return new Response("This account is deactivated.", { status: 403 });
  if (profile.role !== "SUPER_ADMIN" && profile.role !== "ADMIN") return new Response("Not permitted.", { status: 403 });

  const { reportId } = await ctx.params;
  const kind = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "pdf";
  if (!UUID.test(reportId)) return new Response("Report not found.", { status: 404 });

  try {
    const found = await getClientReportDocument(reportId);
    if (!found) return new Response("Report not found or not generated yet.", { status: 404 });
    const allowed = found.format === "BOTH" || (kind === "pdf" ? found.format === "PDF" : found.format === "EXCEL");
    if (!allowed) return new Response("This client's reports are not set up for that format.", { status: 400 });
    const body = kind === "pdf" ? await buildClientReportPdf(found.doc) : new Uint8Array(await buildClientReportWorkbook(found.doc));
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${reportFileName(found.doc, kind)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("client report export failed", error instanceof Error ? error.message : error);
    return new Response("The report could not be exported. Try again.", { status: 500 });
  }
}
