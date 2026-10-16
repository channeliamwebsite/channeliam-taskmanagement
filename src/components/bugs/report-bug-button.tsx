"use client";

import { Bug, Loader2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBugReport } from "@/lib/actions/bugs";

/** Sidebar footer: opens the "Report a bug" form. Pre-fills the current page. */
export function ReportBugButton({ workspaceId, onOpen }: { workspaceId: string | null; onOpen?: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({ title: "", description: "", page: "", steps: "" });
  const set = (k: keyof typeof values, v: string) => setValues((s) => ({ ...s, [k]: v }));

  if (!workspaceId) return null;

  function show() {
    setValues({ title: "", description: "", page: pathname, steps: "" });
    setError(null);
    setOpen(true);
    onOpen?.();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!values.title.trim() || !values.description.trim()) return setError("Title and description are required.");
    startTransition(async () => {
      const r = await createBugReport(workspaceId!, values);
      if (!r.ok) return setError(r.error);
      toast.success("Thanks — your bug report was submitted.");
      setOpen(false);
    });
  }

  return (
    <>
      <div className="mt-auto grid gap-1 border-t pt-3">
        <button
          type="button"
          onClick={show}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Bug className="size-4" aria-hidden="true" /> Report a bug
        </button>
        <Link href="/bugs" className="px-2 text-xs text-muted-foreground hover:underline">
          View bug reports
        </Link>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Report a bug</DialogTitle>
            <DialogDescription>Tell us what went wrong. Admins review every report.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="bug-title">Title *</Label>
              <Input id="bug-title" value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={200} autoFocus className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bug-description">What happened? *</Label>
              <Textarea id="bug-description" value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={5000} rows={4} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bug-page">Page or feature</Label>
              <Input id="bug-page" value={values.page} onChange={(e) => set("page", e.target.value)} maxLength={300} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bug-steps">Steps to reproduce</Label>
              <Textarea
                id="bug-steps"
                value={values.steps}
                onChange={(e) => set("steps", e.target.value)}
                maxLength={5000}
                rows={3}
                placeholder={"1. Open …\n2. Click …\n3. See error"}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Submit report
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
