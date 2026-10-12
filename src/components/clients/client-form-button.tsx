"use client";

import { Loader2, Pencil, Plus } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient, updateClient, type ClientInput } from "@/lib/actions/clients";

const EMPTY: Required<ClientInput> = { name: "", contactName: "", contactEmail: "", notes: "" };

export function ClientFormButton({
  workspaceId,
  clientId,
  initial,
}: {
  workspaceId: string;
  clientId?: string;
  initial?: Required<ClientInput>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof ClientInput, v: string) => setValues((s) => ({ ...s, [k]: v }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!values.name.trim()) return setError("Client name is required.");
    startTransition(async () => {
      const r = clientId ? await updateClient(clientId, values) : await createClient(workspaceId, values);
      if (!r.ok) return setError(r.error);
      toast.success(clientId ? "Client updated" : "Client added");
      setOpen(false);
      if (!clientId) setValues(EMPTY);
    });
  }

  return (
    <>
      {clientId ? (
        <Button variant="ghost" size="sm" onClick={() => { setValues(initial ?? EMPTY); setOpen(true); }} aria-label="Edit client">
          <Pencil aria-hidden="true" />
        </Button>
      ) : (
        <Button className="h-9" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" /> New client
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{clientId ? "Edit client" : "New client"}</DialogTitle>
            <DialogDescription>Clients group projects; projects group tasks.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <div className="grid gap-1.5">
              <Label htmlFor="client-name">Name</Label>
              <Input id="client-name" value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoFocus className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="client-contact">Contact person</Label>
              <Input id="client-contact" value={values.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={200} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="client-email">Contact email</Label>
              <Input id="client-email" type="email" value={values.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="client-notes">Description</Label>
              <Textarea id="client-notes" value={values.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={5000} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {clientId ? "Save" : "Add client"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
