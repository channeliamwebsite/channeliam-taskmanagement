"use client";

import { Eye, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { revealPan, setIdentity, updateHrProfile, type HrProfileInput } from "@/lib/actions/hr-profiles";
import { maskAadhaar, maskPan } from "@/lib/hr/pan";

import { GENDER_LABELS, STATUS_LABELS, TYPE_LABELS } from "./profile-view";

/** Super admin: personal and employment details. Name, email, department, designation and manager are edited on the Employees page. */
export function HrProfileForm({ userId, initial }: { userId: string; initial: HrProfileInput }) {
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(initial);
  const set = (k: keyof HrProfileInput) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateHrProfile(userId, v);
          if (r.ok) toast.success("HR profile saved.");
          else toast.error(r.error);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="hr-gender">Gender</Label>
          <NativeSelect id="hr-gender" value={v.gender ?? ""} onChange={set("gender")}>
            <option value="">—</option>
            {Object.entries(GENDER_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hr-dob">Date of birth</Label>
          <Input id="hr-dob" type="date" value={v.dateOfBirth ?? ""} onChange={set("dateOfBirth")} className="h-9" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hr-joining">Joining date</Label>
          <Input id="hr-joining" type="date" value={v.joiningDate ?? ""} onChange={set("joiningDate")} className="h-9" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hr-pemail">Personal email</Label>
          <Input id="hr-pemail" type="email" value={v.personalEmail ?? ""} onChange={set("personalEmail")} maxLength={254} className="h-9" autoComplete="off" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hr-phone">Phone</Label>
          <Input id="hr-phone" type="tel" value={v.phone ?? ""} onChange={set("phone")} maxLength={20} className="h-9" autoComplete="off" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hr-status">Employment status</Label>
          <NativeSelect id="hr-status" value={v.employmentStatus} onChange={set("employmentStatus")}>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hr-type">Employment type</Label>
          <NativeSelect id="hr-type" value={v.employmentType} onChange={set("employmentType")}>
            {Object.entries(TYPE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="hr-address">Address</Label>
        <Textarea id="hr-address" value={v.address ?? ""} onChange={set("address")} maxLength={500} rows={2} autoComplete="off" />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Save HR details
        </Button>
      </div>
    </form>
  );
}

/** Super admin: PAN (encrypted on the server) and Aadhaar last four; audited reveal of the full PAN. */
export function IdentityForm({ userId, panLast4, aadhaarLast4 }: { userId: string; panLast4: string | null; aadhaarLast4: string | null }) {
  const [pending, startTransition] = useTransition();
  const [pan, setPan] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [revealOpen, setRevealOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  function save(input: { pan?: string; aadhaarLast4?: string }, done: string) {
    startTransition(async () => {
      const r = await setIdentity(userId, input);
      if (r.ok) {
        toast.success(done);
        setPan("");
        setAadhaar("");
      } else toast.error(r.error);
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="id-pan">PAN · current {maskPan(panLast4)}</Label>
          <div className="flex gap-2">
            <Input id="id-pan" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" className="h-9 font-mono" autoComplete="off" spellCheck={false} />
            <Button variant="outline" disabled={pending || pan.trim().length !== 10} onClick={() => save({ pan }, "PAN saved (encrypted).")}>
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Stored encrypted; shown masked.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="id-aadhaar">Aadhaar last 4 digits · current {maskAadhaar(aadhaarLast4)}</Label>
          <div className="flex gap-2">
            <Input id="id-aadhaar" value={aadhaar} onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} placeholder="1234" className="h-9 font-mono" autoComplete="off" />
            <Button variant="outline" disabled={pending || aadhaar.length !== 4} onClick={() => save({ aadhaarLast4: aadhaar }, "Aadhaar last 4 digits saved.")}>
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Only the last 4 digits are kept. Never enter the full number.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {panLast4 ? (
          <Button variant="outline" size="sm" onClick={() => setRevealOpen(true)}>
            <Eye aria-hidden="true" /> View full PAN
          </Button>
        ) : null}
        {panLast4 ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => save({ pan: "" }, "PAN removed.")}>
            Remove PAN
          </Button>
        ) : null}
        {aadhaarLast4 ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => save({ aadhaarLast4: "" }, "Aadhaar digits removed.")}>
            Remove Aadhaar digits
          </Button>
        ) : null}
      </div>

      <Dialog
        open={revealOpen}
        onOpenChange={(o) => {
          if (!o) {
            setRevealOpen(false);
            setRevealed(null);
            setReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>View full PAN</DialogTitle>
            <DialogDescription>This is recorded in the HR audit log with your name and reason.</DialogDescription>
          </DialogHeader>
          {revealed ? (
            <p className="rounded-md bg-muted p-3 text-center font-mono text-lg tracking-widest" aria-live="polite">
              {revealed}
            </p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="reveal-reason">Reason</Label>
              <Input id="reveal-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Payroll setup" className="h-9" autoComplete="off" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevealOpen(false)}>
              Close
            </Button>
            {revealed ? null : (
              <Button
                disabled={pending || reason.trim().length < 3}
                onClick={() =>
                  startTransition(async () => {
                    const r = await revealPan(userId, reason);
                    if (r.ok) setRevealed(r.data.pan);
                    else toast.error(r.error);
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Show PAN
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
