"use client";

import { Loader2, NotebookPen } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { saveMeetingRecord } from "@/lib/actions/meeting-records";
import { formatDate } from "@/lib/domain";

type Status = "SCHEDULED" | "HELD" | "CANCELLED";

export type MeetingRecordValue = {
  status: Status;
  agenda: string | null;
  notes: string | null;
  decisions: string | null;
  followUpTaskIds: string[];
};

/** Super admin: status, agenda, notes, decisions and follow-up tasks for one meeting on one date. */
export function MeetingRecordButton({
  workspaceId,
  meetingId,
  title,
  date,
  record,
  taskOptions,
}: {
  workspaceId: string;
  meetingId: string;
  title: string;
  date: string;
  record: MeetingRecordValue | null;
  /** Existing tasks that can be linked as follow-up actions. */
  taskOptions: { id: string; title: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>(record?.status ?? "SCHEDULED");
  const [agenda, setAgenda] = useState(record?.agenda ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [decisions, setDecisions] = useState(record?.decisions ?? "");
  const [followUps, setFollowUps] = useState<string[]>(record?.followUpTaskIds ?? []);

  function openDialog() {
    setStatus(record?.status ?? "SCHEDULED");
    setAgenda(record?.agenda ?? "");
    setNotes(record?.notes ?? "");
    setDecisions(record?.decisions ?? "");
    setFollowUps(record?.followUpTaskIds ?? []);
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const r = await saveMeetingRecord({ workspaceId, meetingLinkId: meetingId, meetingDate: date, status, agenda, notes, decisions, followUpTaskIds: followUps });
      if (r.ok) {
        toast.success("Meeting record saved");
        setOpen(false);
      } else toast.error(r.error);
    });
  }

  // Linked tasks stay selectable even if they are no longer open.
  const options = [...taskOptions];
  for (const id of followUps) if (!options.some((o) => o.id === id)) options.push({ id, title: "Linked task" });

  return (
    <>
      <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={openDialog}>
        <NotebookPen className="size-3.5" aria-hidden="true" />
        {record ? "Notes" : "Record"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{formatDate(date)} · visible to super admins only</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-status">Status</Label>
              <NativeSelect id="meeting-status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                <option value="SCHEDULED">Scheduled</option>
                <option value="HELD">Held</option>
                <option value="CANCELLED">Cancelled</option>
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-agenda">Agenda</Label>
              <Textarea id="meeting-agenda" value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={5000} rows={3} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-notes">Notes</Label>
              <Textarea id="meeting-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10000} rows={4} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-decisions">Decisions</Label>
              <Textarea id="meeting-decisions" value={decisions} onChange={(e) => setDecisions(e.target.value)} maxLength={5000} rows={3} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-followups">Follow-up tasks</Label>
              <select
                id="meeting-followups"
                multiple
                size={6}
                value={followUps}
                onChange={(e) => setFollowUps([...e.target.selectedOptions].map((o) => o.value))}
                className="rounded-lg border border-input bg-background px-2 py-1 text-sm"
              >
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Link existing tasks (Ctrl/Cmd-click to choose several). Create new tasks from Tasks first.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
