// Client report PDF. Server-side only: called from the export Route Handler
// with a stored snapshot. Uses the standard Helvetica fonts (no font files).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import {
  formatReportDate,
  importantUpdates,
  nextPriorities,
  periodLabel,
  priorityLabel,
  stateLabel,
  type ClientReportDocument,
} from "./snapshot.ts";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const WIN_ANSI_EXTRA = new Set("–—‘’“”•…€".split(""));

/** The standard fonts only encode WinAnsi; anything else becomes "?". */
export function pdfSafe(text: string): string {
  return [...text.replace(/[\r\n\t]+/g, " ")]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch) ? ch : "?";
    })
    .join("");
}

class Writer {
  page!: PDFPage;
  y = 0;
  private doc: PDFDocument;
  private regular: PDFFont;
  private bold: PDFFont;
  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }
  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage();
  }
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = pdfSafe(text).split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }
  text(text: string, opts: { size?: number; bold?: boolean; x?: number; width?: number; color?: [number, number, number] } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.regular;
    const x = opts.x ?? MARGIN;
    const width = opts.width ?? A4[0] - MARGIN - x;
    for (const line of this.wrap(text, font, size, width)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: rgb(...(opts.color ?? [0.1, 0.1, 0.1])) });
      this.y -= size + 4;
    }
  }
  heading(text: string) {
    this.y -= 8;
    this.ensure(40);
    this.text(text, { size: 13, bold: true });
    this.y -= 2;
  }
  /** A simple table: fixed column widths (fractions of the text width), rows wrap. */
  table(headers: string[], widths: number[], rows: string[][]) {
    const total = A4[0] - 2 * MARGIN;
    const xs = widths.reduce<number[]>((acc, w, i) => [...acc, i === 0 ? MARGIN : acc[i - 1] + widths[i - 1] * total], []);
    const draw = (cells: string[], bold: boolean) => {
      const size = 9;
      const font = bold ? this.bold : this.regular;
      const wrapped = cells.map((c, i) => this.wrap(c, font, size, widths[i] * total - 6));
      const height = Math.max(...wrapped.map((w) => w.length)) * (size + 3) + 4;
      this.ensure(height);
      wrapped.forEach((lines, i) =>
        lines.forEach((l, j) => this.page.drawText(l, { x: xs[i], y: this.y - size - j * (size + 3), size, font, color: rgb(0.1, 0.1, 0.1) })),
      );
      this.y -= height;
    };
    draw(headers, true);
    if (!rows.length) this.text("None.", { size: 9, color: [0.4, 0.4, 0.4] });
    for (const r of rows) draw(r, false);
  }
}

export async function buildClientReportPdf(doc: ClientReportDocument): Promise<Uint8Array> {
  const s = doc.snapshot;
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`Client report – ${s.client.name} – ${periodLabel(s.period)}`));
  pdf.setCreationDate(doc.generatedAt ? new Date(doc.generatedAt) : new Date());
  const w = new Writer(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold));

  w.text("Client report", { size: 20, bold: true });
  w.y -= 4;
  w.text(s.client.name, { size: 14, bold: true });
  if (s.client.contact_name) w.text(`Contact: ${s.client.contact_name}`);
  w.text(`Reporting period: ${periodLabel(s.period)}`);
  w.text(`Generated: ${doc.generatedAt ? formatReportDate(doc.generatedAt) : "—"}`, { color: [0.4, 0.4, 0.4] });

  w.heading("Summary");
  const t = s.totals;
  w.table(
    ["Total tasks", "Completed", "In progress", "Pending", "Overdue", "Completion"],
    [1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6],
    [[String(t.total), String(t.completed), String(t.in_progress), String(t.pending), String(t.overdue), `${t.completion_percent}%`]],
  );

  w.heading("Important updates");
  for (const l of importantUpdates(doc)) w.text(`• ${l}`);

  w.heading("Project-wise progress");
  w.table(
    ["Project", "Total", "Done", "In progress", "Pending", "Overdue", "%"],
    [0.36, 0.1, 0.1, 0.12, 0.1, 0.12, 0.1],
    s.projects.map((p) => [p.project_name, String(p.total), String(p.completed), String(p.in_progress), String(p.pending), String(p.overdue), `${p.completion_percent}%`]),
  );

  w.heading("Team work summary");
  w.table(["Team", "Completed", "Open"], [0.6, 0.2, 0.2], s.teams.map((m) => [m.team, String(m.completed), String(m.open)]));

  w.heading("Completed deliverables");
  w.table(
    ["Deliverable", "Project", "Completed on"],
    [0.52, 0.3, 0.18],
    s.deliverables.map((d) => [d.title, d.project_name, formatReportDate(d.completed_on)]),
  );

  w.heading("Outstanding work");
  w.table(
    ["Task", "Project", "Priority", "Status", "Due"],
    [0.4, 0.22, 0.13, 0.12, 0.13],
    s.outstanding.map((o) => [o.title, o.project_name, priorityLabel(o.priority), stateLabel(o.state), `${formatReportDate(o.due_date)}${o.overdue ? " (overdue)" : ""}`]),
  );

  w.heading("Next-period priorities");
  for (const l of nextPriorities(doc)) w.text(`• ${l}`);

  return pdf.save();
}
