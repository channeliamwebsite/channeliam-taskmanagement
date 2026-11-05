// Client report workbook (Excel). Server-side only: called from the export
// Route Handler with a stored snapshot; no database access here.

import ExcelJS from "exceljs";

import {
  formatReportDate,
  importantUpdates,
  nextPriorities,
  periodLabel,
  priorityLabel,
  stateLabel,
  type ClientReportDocument,
} from "./snapshot.ts";

function table(sheet: ExcelJS.Worksheet, columns: { header: string; key: string; width: number }[], rows: Record<string, unknown>[]) {
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of rows) sheet.addRow(r);
}

export async function buildClientReportWorkbook(doc: ClientReportDocument): Promise<Buffer> {
  const s = doc.snapshot;
  const wb = new ExcelJS.Workbook();
  wb.created = doc.generatedAt ? new Date(doc.generatedAt) : new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [{ width: 28 }, { width: 60 }];
  const rows: [string, string | number][] = [
    ["Client", s.client.name],
    ["Contact", s.client.contact_name ?? "—"],
    ["Reporting period", periodLabel(s.period)],
    ["Generated", doc.generatedAt ? formatReportDate(doc.generatedAt) : "—"],
    ["Total tasks", s.totals.total],
    ["Completed", s.totals.completed],
    ["In progress", s.totals.in_progress],
    ["Pending", s.totals.pending],
    ["Overdue", s.totals.overdue],
    ["Completion", `${s.totals.completion_percent}%`],
  ];
  summary.addRow(["Client report"]).font = { bold: true, size: 14 };
  summary.addRow([]);
  for (const r of rows) summary.addRow(r).getCell(1).font = { bold: true };
  summary.addRow([]);
  summary.addRow(["Important updates"]).font = { bold: true };
  for (const l of importantUpdates(doc)) summary.addRow(["", l]);
  summary.addRow([]);
  summary.addRow(["Next-period priorities"]).font = { bold: true };
  for (const l of nextPriorities(doc)) summary.addRow(["", l]);

  table(
    wb.addWorksheet("Projects"),
    [
      { header: "Project", key: "project_name", width: 36 },
      { header: "Total", key: "total", width: 10 },
      { header: "Completed", key: "completed", width: 12 },
      { header: "In progress", key: "in_progress", width: 12 },
      { header: "Pending", key: "pending", width: 10 },
      { header: "Overdue", key: "overdue", width: 10 },
      { header: "Completion %", key: "completion_percent", width: 14 },
    ],
    s.projects,
  );
  table(
    wb.addWorksheet("Team summary"),
    [
      { header: "Team", key: "team", width: 30 },
      { header: "Completed", key: "completed", width: 12 },
      { header: "Open", key: "open", width: 10 },
    ],
    s.teams,
  );
  table(
    wb.addWorksheet("Completed deliverables"),
    [
      { header: "Deliverable", key: "title", width: 60 },
      { header: "Project", key: "project_name", width: 30 },
      { header: "Completed on", key: "completed_on", width: 16 },
    ],
    s.deliverables.map((d) => ({ ...d, completed_on: formatReportDate(d.completed_on) })),
  );
  table(
    wb.addWorksheet("Outstanding work"),
    [
      { header: "Task", key: "title", width: 60 },
      { header: "Project", key: "project_name", width: 30 },
      { header: "Priority", key: "priority", width: 14 },
      { header: "Status", key: "state", width: 14 },
      { header: "Due", key: "due_date", width: 14 },
      { header: "Overdue", key: "overdue", width: 10 },
    ],
    s.outstanding.map((o) => ({
      ...o,
      priority: priorityLabel(o.priority),
      state: stateLabel(o.state),
      due_date: formatReportDate(o.due_date),
      overdue: o.overdue ? "Yes" : "",
    })),
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}
