"use client";

import { CalendarOff, Check, Loader2, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/app/page-header";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { applyForLeave, cancelLeave, decideLeave, previewWorkingDays } from "@/lib/actions/hr";
import {
  LEAVE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_STYLES,
  LEAVE_TYPES,
  formatDateRange,
  validateLeaveInput,
  type LeaveApplication,
  type LeaveStatus,
  type LeaveType,
} from "@/lib/hr/leave";
import { cn } from "@/lib/utils";

const badge = "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset";

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <span className={cn(badge, LEAVE_STATUS_STYLES[status])}>{LEAVE_STATUS_LABELS[status]}</span>;
}

/** Employee's application form with a live working-days count from the database. */
export function LeaveApplyForm({ today, clAvailable }: { today: string; clAvailable: number | null }) {
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<LeaveType>("CL");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ key: string; days: number | null } | null>(null);
  const rangeKey = start && end && end >= start ? `${start}|${end}` : null;
  // Only a preview for the dates currently chosen counts (stale answers are ignored).
  const days = rangeKey && preview?.key === rangeKey ? preview.days : null;

  useEffect(() => {
    if (!rangeKey) return;
    let live = true;
    const [s, e] = rangeKey.split("|");
    previewWorkingDays(s!, e!).then((r) => live && setPreview({ key: rangeKey, days: r.ok ? r.data.days : null }));
    return () => {
      live = false;
    };
  }, [rangeKey]);

  function submit() {
    const parsed = validateLeaveInput({ type, start, end, reason });
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    startTransition(async () => {
      const r = await applyForLeave(parsed.value);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Application submitted. It is pending approval.");
      setReason("");
    });
  }

  const overBalance = type === "CL" && days !== null && clAvailable !== null && days > clAvailable;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="leave-type">Leave type</Label>
          <NativeSelect id="leave-type" value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEAVE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="leave-start">Start date</Label>
          <Input id="leave-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="leave-end">End date</Label>
          <Input id="leave-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="h-9" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="leave-reason">Reason</Label>
        <Textarea id="leave-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} placeholder="Briefly explain the reason" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={cn("text-sm", overBalance ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
          {days === null
            ? "Choose the dates to see the working days."
            : `${days} working day${days === 1 ? "" : "s"} (Sundays and public holidays are not counted)${overBalance ? ` · only ${clAvailable} CL available now (later months bring new credits)` : ""}`}
        </p>
        <Button onClick={submit} disabled={pending || days === 0}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Submit application
        </Button>
      </div>
    </div>
  );
}

/** The signed-in employee's own applications; pending ones can be cancelled. */
export function MyLeaveTable({ applications }: { applications: LeaveApplication[] }) {
  const [pending, startTransition] = useTransition();
  const [cancelId, setCancelId] = useState<string | null>(null);
  if (!applications.length) {
    return <EmptyState icon={CalendarOff} title="No applications yet" description="Applications you submit appear here with their status." />;
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Dates</TableHead>
            <TableHead className="text-right">Days</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="whitespace-nowrap">{LEAVE_LABELS[a.type]}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDateRange(a.start, a.end)}</TableCell>
              <TableCell className="text-right tabular-nums">{a.workingDays}</TableCell>
              <TableCell className="max-w-64 truncate" title={a.reason}>
                {a.reason}
                {a.status === "REJECTED" && a.rejectionReason ? <span className="block truncate text-xs text-destructive">Rejected: {a.rejectionReason}</span> : null}
              </TableCell>
              <TableCell>
                <LeaveStatusBadge status={a.status} />
              </TableCell>
              <TableCell>
                {a.status === "PENDING" ? (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => setCancelId(a.id)}>
                    Cancel
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={(o) => !o && setCancelId(null)}
        title="Cancel this application?"
        description="It is withdrawn and will not be reviewed. You can apply again for these dates."
        confirmLabel="Cancel application"
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await cancelLeave(cancelId!);
            if (r.ok) toast.success("Application cancelled.");
            else toast.error(r.error);
            setCancelId(null);
          })
        }
      />
    </>
  );
}

export type ReviewRow = LeaveApplication & {
  applicant: { userId: string; name: string; email: string | null; department: string | null; jobTitle: string | null };
  clAvailable: number | null;
};

/** Super admin review: approve or reject (with a reason). The database refuses own applications. */
export function LeaveReviewTable({ rows, currentUserId }: { rows: ReviewRow[]; currentUserId: string }) {
  const [pending, startTransition] = useTransition();
  const [approve, setApprove] = useState<ReviewRow | null>(null);
  const [reject, setReject] = useState<ReviewRow | null>(null);
  const [reason, setReason] = useState("");

  function decide(row: ReviewRow, ok: boolean) {
    startTransition(async () => {
      const r = await decideLeave(row.id, ok, ok ? undefined : reason);
      if (r.ok) {
        toast.success(ok ? "Leave approved." : "Leave rejected.");
        setApprove(null);
        setReject(null);
        setReason("");
      } else toast.error(r.error);
    });
  }

  if (!rows.length) return <EmptyState icon={CalendarOff} title="No applications" description="Nothing matches this filter." />;
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Dates</TableHead>
            <TableHead className="text-right">Days</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">CL left</TableHead>
            <TableHead>Applied</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <span className="block font-medium">{a.applicant.name}</span>
                <span className="block text-xs text-muted-foreground">{a.applicant.jobTitle ?? a.applicant.email ?? ""}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{a.applicant.department ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap">{a.type}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{formatDateRange(a.start, a.end)}</TableCell>
              <TableCell className="text-right tabular-nums">{a.workingDays}</TableCell>
              <TableCell className="max-w-56 truncate" title={a.reason}>
                {a.reason}
                {a.status === "REJECTED" && a.rejectionReason ? <span className="block truncate text-xs text-destructive">Rejected: {a.rejectionReason}</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{a.type === "CL" && a.clAvailable !== null ? a.clAvailable : "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{a.createdAt.slice(0, 10)}</TableCell>
              <TableCell>
                <LeaveStatusBadge status={a.status} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {a.status === "PENDING" && a.applicant.userId !== currentUserId ? (
                  <div className="flex gap-1">
                    <Button size="sm" disabled={pending} onClick={() => setApprove(a)} aria-label={`Approve ${a.applicant.name}'s leave`}>
                      <Check aria-hidden="true" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setReject(a)} aria-label={`Reject ${a.applicant.name}'s leave`}>
                      <X aria-hidden="true" /> Reject
                    </Button>
                  </div>
                ) : a.status === "PENDING" ? (
                  <span className="text-xs text-muted-foreground">Your own — another super admin decides</span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={approve !== null}
        onOpenChange={(o) => !o && setApprove(null)}
        title={approve ? `Approve ${approve.applicant.name}'s ${LEAVE_LABELS[approve.type]}?` : ""}
        description={approve ? `${formatDateRange(approve.start, approve.end)} · ${approve.workingDays} working day(s). It will show on their attendance.` : ""}
        confirmLabel="Approve"
        pending={pending}
        onConfirm={() => approve && decide(approve, true)}
      />

      <Dialog open={reject !== null} onOpenChange={(o) => !o && (setReject(null), setReason(""))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {reject?.applicant.name}&apos;s application?</DialogTitle>
            <DialogDescription>{reject ? `${LEAVE_LABELS[reject.type]} · ${formatDateRange(reject.start, reject.end)}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="reject-reason">Reason (shown to the employee)</Label>
            <Textarea id="reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReject(null)} disabled={pending}>
              Back
            </Button>
            <Button variant="destructive" disabled={pending || reason.trim().length < 3} onClick={() => reject && decide(reject, false)}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
