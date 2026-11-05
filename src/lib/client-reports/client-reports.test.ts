import assert from "node:assert/strict";
import { describe, it } from "node:test";

import ExcelJS from "exceljs";

import { buildClientReportWorkbook } from "./excel.ts";
import { buildClientReportPdf, pdfSafe } from "./pdf.ts";
import { importantUpdates, isSnapshot, nextPriorities, periodLabel, reportFileName, type ClientReportDocument } from "./snapshot.ts";

const doc = (over: Partial<ClientReportDocument> = {}): ClientReportDocument => ({
  generatedAt: "2026-10-02T00:45:00Z",
  updatesNote: null,
  prioritiesNote: null,
  snapshot: {
    version: 1,
    timezone: "Asia/Kolkata",
    client: { name: "Client One / Ltd", contact_name: "Ravi" },
    period: { start: "2026-09-01", end: "2026-09-15", frequency_days: 15 },
    totals: { total: 4, completed: 1, pending: 1, in_progress: 2, overdue: 1, blocked: 1, completion_percent: 25 },
    projects: [{ project_name: "Website", total: 4, completed: 1, in_progress: 2, pending: 1, overdue: 1, completion_percent: 25 }],
    teams: [{ team: "Design", completed: 1, open: 1 }],
    deliverables: [{ title: "Home page", project_name: "Website", completed_on: "2026-09-05" }],
    outstanding: [{ title: "Contact form", project_name: "Website", priority: "URGENT", state: "PENDING", due_date: "2026-09-12", overdue: true }],
    next_priorities: [{ title: "Contact form", project_name: "Website", priority: "URGENT", due_date: "2026-09-12" }],
  },
  ...over,
});

describe("client report snapshot helpers", () => {
  it("labels the period and file name", () => {
    assert.equal(periodLabel(doc().snapshot.period), "1 Sep 2026 – 15 Sep 2026");
    assert.equal(reportFileName(doc(), "pdf"), "client-report-Client-One-Ltd-2026-09-01-to-2026-09-15.pdf");
  });
  it("puts the admin's notes before the facts", () => {
    const lines = importantUpdates(doc({ updatesNote: "Launched the home page.\n\n" }));
    assert.equal(lines[0], "Launched the home page.");
    assert.ok(lines.some((l) => l.startsWith("1 of 4 tasks completed")));
    assert.ok(lines.some((l) => l.includes("past the due date")));
    assert.ok(lines.some((l) => l.includes("blocked")));
  });
  it("lists next-period priorities, or says there are none", () => {
    assert.match(nextPriorities(doc())[0], /^Contact form \(Website, P1 Critical, due 12 Sep 2026\)$/);
    const empty = doc();
    empty.snapshot.next_priorities = [];
    assert.deepEqual(nextPriorities(empty), ["No open priorities."]);
  });
  it("recognises a stored snapshot", () => {
    assert.ok(isSnapshot(doc().snapshot));
    assert.ok(!isSnapshot(null));
    assert.ok(!isSnapshot({ client: {} }));
  });
});

describe("client report exports", () => {
  it("builds a workbook with every section", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildClientReportWorkbook(doc())) as unknown as ExcelJS.Buffer);
    assert.deepEqual(wb.worksheets.map((s) => s.name), ["Summary", "Projects", "Team summary", "Completed deliverables", "Outstanding work"]);
    assert.equal(wb.getWorksheet("Outstanding work")!.getRow(2).getCell(3).value, "P1 Critical");
  });
  it("builds a PDF", async () => {
    const bytes = await buildClientReportPdf(doc({ updatesNote: "Notes with ₹ and हिंदी" }));
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
    assert.ok(bytes.length > 1000);
  });
  it("replaces characters the standard fonts cannot encode", () => {
    assert.equal(pdfSafe("Café – ₹100\nnext"), "Café – ?100 next");
  });
  it("adds pages for long reports", async () => {
    const long = doc();
    long.snapshot.outstanding = Array.from({ length: 300 }, (_, i) => ({
      title: `Task ${i}`, project_name: "Website", priority: "LOW", state: "PENDING" as const, due_date: null, overdue: false,
    }));
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(await buildClientReportPdf(long));
    assert.ok(pdf.getPageCount() > 3);
  });
});
