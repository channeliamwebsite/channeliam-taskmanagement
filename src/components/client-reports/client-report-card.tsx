"use client";

import { Download, Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  authorizeReportRecipient,
  generateClientReportsNow,
  retryClientReport,
  reviewClientReport,
  saveClientReportSettings,
} from "@/lib/actions/client-reports";
import { FORMAT_LABELS, formatReportDate, periodLabel, type ReportFormat } from "@/lib/client-reports/snapshot";
import type { ClientReportOverview, ClientReportRow } from "@/lib/data/client-reports";
import { formatDateTime } from "@/lib/domain";

const STATUS_STYLES: Record<ClientReportRow["status"], string> = {
  READY: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PENDING: "bg-slate-50 text-slate-700 ring-slate-200",
  FAILED: "bg-red-50 text-red-700 ring-red-200",
};

export function ClientReportCard({ overview, today }: { overview: ClientReportOverview; today: string }) {
  const s = overview.settings;
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    frequencyDays: s?.frequencyDays ?? 30,
    format: (s?.format ?? "BOTH") as ReportFormat,
    firstPeriodStart: s?.firstPeriodStart ?? `${today.slice(0, 7)}-01`,
    isActive: s?.isActive ?? true,
    recipientEmail: s?.recipientEmail ?? "",
  });
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const r = await fn();
      if (r.ok) toast.success(success);
      else toast.error(r.error ?? "Something went wrong.");
    });
  const formats = form.format === "BOTH" ? (["pdf", "xlsx"] as const) : form.format === "PDF" ? (["pdf"] as const) : (["xlsx"] as const);

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveClientReportSettings(overview.clientId, form), "Report settings saved");
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={`freq-${overview.clientId}`}>Frequency</Label>
          <NativeSelect
            id={`freq-${overview.clientId}`}
            value={form.frequencyDays}
            onChange={(e) => setForm({ ...form, frequencyDays: Number(e.target.value) as 15 | 30 })}
          >
            <option value={15}>Every 15 days</option>
            <option value={30}>Every 30 days</option>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`format-${overview.clientId}`}>Format</Label>
          <NativeSelect
            id={`format-${overview.clientId}`}
            value={form.format}
            onChange={(e) => setForm({ ...form, format: e.target.value as ReportFormat })}
          >
            {(Object.keys(FORMAT_LABELS) as ReportFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`start-${overview.clientId}`}>First period starts</Label>
          <Input
            id={`start-${overview.clientId}`}
            type="date"
            className="h-9"
            value={form.firstPeriodStart}
            disabled={overview.reports.length > 0}
            title={overview.reports.length ? "Later periods continue after the last report." : undefined}
            onChange={(e) => setForm({ ...form, firstPeriodStart: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`email-${overview.clientId}`}>Recipient email (optional)</Label>
          <Input
            id={`email-${overview.clientId}`}
            type="email"
            className="h-9"
            value={form.recipientEmail}
            onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })}
          />
        </div>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Save
          </Button>
        </div>
      </form>

      {s ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !s.isActive}
            onClick={() =>
              startTransition(async () => {
                const r = await generateClientReportsNow(overview.clientId);
                if (r.ok) toast.success(r.data.generated ? `${r.data.generated} report(s) generated` : "No new period has ended yet");
                else toast.error(r.error);
              })
            }
          >
            <RefreshCw aria-hidden="true" /> Generate due reports
          </Button>
          {s.recipientEmail ? (
            s.recipientAuthorized ? (
              <>
                <span className="text-muted-foreground">Recipient {s.recipientEmail} is authorised.</span>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => authorizeReportRecipient(overview.clientId, false), "Authorisation withdrawn")}>
                  Withdraw
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => authorizeReportRecipient(overview.clientId, true), "Recipient authorised")}>
                Authorise {s.recipientEmail} to receive reports
              </Button>
            )
          ) : null}
          <span className="text-xs text-muted-foreground">Automatic delivery: off (available after email setup).</span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Save settings to start reporting for this client.</p>
      )}

      {overview.reports.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Period</th>
                <th className="px-2 py-1.5 font-medium">Generated</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5 font-medium">Review</th>
                <th className="px-2 py-1.5 text-right font-medium">Export</th>
              </tr>
            </thead>
            <tbody>
              {overview.reports.map((r) => (
                <ReportRow key={r.id} report={r} formats={formats} />
              ))}
            </tbody>
          </table>
        </div>
      ) : s ? (
        <p className="text-sm text-muted-foreground">No reports yet. The first one is generated after {formatReportDate(s.firstPeriodStart)} + {s.frequencyDays} days.</p>
      ) : null}
    </div>
  );
}

function ReportRow({ report: r, formats }: { report: ClientReportRow; formats: readonly ("pdf" | "xlsx")[] }) {
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState({ updatesNote: r.updatesNote ?? "", prioritiesNote: r.prioritiesNote ?? "" });
  const review = (markReviewed: boolean) =>
    startTransition(async () => {
      const res = await reviewClientReport(r.id, { ...notes, markReviewed });
      if (res.ok) toast.success(markReviewed ? "Report marked as reviewed" : "Notes saved");
      else toast.error(res.error);
    });

  return (
    <tr className="border-t align-top">
      <td className="px-2 py-2">{periodLabel({ start: r.periodStart, end: r.periodEnd })}</td>
      <td className="px-2 py-2 text-muted-foreground">{r.generatedAt ? formatDateTime(r.generatedAt) : "—"}</td>
      <td className="px-2 py-2">
        <span className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[r.status]}`}>{r.status}</span>
        {r.status === "FAILED" ? (
          <div className="mt-1 grid gap-1">
            <span className="text-xs text-muted-foreground">
              {r.error ?? "Unknown error"} · attempt {r.attempts}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await retryClientReport(r.id);
                  if (res.ok) toast[res.data.status === "READY" ? "success" : "error"](res.data.status === "READY" ? "Report generated" : "The report failed again");
                  else toast.error(res.error);
                })
              }
            >
              Retry
            </Button>
          </div>
        ) : null}
      </td>
      <td className="px-2 py-2">
        {r.status !== "READY" ? (
          "—"
        ) : r.reviewedAt ? (
          <span className="text-xs text-muted-foreground">Reviewed {formatDateTime(r.reviewedAt)}</span>
        ) : (
          <details>
            <summary className="cursor-pointer text-xs underline">Add notes / review</summary>
            <div className="mt-2 grid w-72 gap-2">
              <Label className="text-xs">Important updates</Label>
              <Textarea rows={3} value={notes.updatesNote} onChange={(e) => setNotes({ ...notes, updatesNote: e.target.value })} />
              <Label className="text-xs">Next-period priorities</Label>
              <Textarea rows={3} value={notes.prioritiesNote} onChange={(e) => setNotes({ ...notes, prioritiesNote: e.target.value })} />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={pending} onClick={() => review(false)}>
                  Save notes
                </Button>
                <Button size="sm" disabled={pending} onClick={() => review(true)}>
                  Mark reviewed
                </Button>
              </div>
            </div>
          </details>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {r.status === "READY" ? (
          <div className="flex justify-end gap-1.5">
            {formats.map((f) => (
              <a key={f} href={`/client-reports/${r.id}/export?format=${f}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Download aria-hidden="true" /> {f === "pdf" ? "PDF" : "Excel"}
              </a>
            ))}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
