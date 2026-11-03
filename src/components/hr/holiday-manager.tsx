"use client";

import { CalendarHeart, Loader2, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { EmptyState } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cancelHoliday, createHoliday, updateHoliday } from "@/lib/actions/hr";
import { formatDay } from "@/lib/attendance";
import type { Holiday } from "@/lib/hr/leave";

/** Super admin holiday list for one year: add, edit, cancel (never delete). */
export function HolidayManager({ holidays, defaultDate }: { holidays: Holiday[]; defaultDate: string }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Holiday | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Holiday | null>(null);
  const [name, setName] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [description, setDescription] = useState("");

  function open(h: Holiday | "new") {
    setEditing(h);
    setName(h === "new" ? "" : h.name);
    setDate(h === "new" ? defaultDate : h.date);
    setDescription(h === "new" ? "" : (h.description ?? ""));
  }

  function save() {
    startTransition(async () => {
      const input = { name, date, description };
      const r = editing === "new" ? await createHoliday(input) : await updateHoliday((editing as Holiday).id, input);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(editing === "new" ? "Holiday added for all employees." : "Holiday updated.");
      setEditing(null);
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button onClick={() => open("new")}>
          <Plus aria-hidden="true" /> Add holiday
        </Button>
      </div>
      {holidays.length === 0 ? (
        <EmptyState icon={CalendarHeart} title="No holidays this year" description="Holidays apply to every active employee and are not counted as working days." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Holiday</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays.map((h) => (
              <TableRow key={h.id} className={h.isActive ? undefined : "text-muted-foreground"}>
                <TableCell className="whitespace-nowrap tabular-nums">{formatDay(h.date)}</TableCell>
                <TableCell className="font-medium">{h.name}</TableCell>
                <TableCell className="max-w-72 truncate" title={h.description ?? ""}>
                  {h.description ?? "—"}
                </TableCell>
                <TableCell>{h.isActive ? "Active" : "Cancelled"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {h.isActive ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => open(h)} disabled={pending}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(h)} disabled={pending}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add a public holiday" : "Edit holiday"}</DialogTitle>
            <DialogDescription>Applies to every active employee. Past attendance is not changed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="holiday-name">Holiday name</Label>
              <Input id="holiday-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="holiday-date">Date</Label>
              <Input id="holiday-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="holiday-description">Description (optional)</Label>
              <Textarea id="holiday-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={pending}>
              Back
            </Button>
            <Button onClick={save} disabled={pending || name.trim().length < 2 || !date}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={cancelling ? `Cancel ${cancelling.name}?` : ""}
        description="The date becomes a working day again for everyone. The holiday stays in the history."
        confirmLabel="Cancel holiday"
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await cancelHoliday(cancelling!.id);
            if (r.ok) toast.success("Holiday cancelled.");
            else toast.error(r.error);
            setCancelling(null);
          })
        }
      />
    </div>
  );
}
