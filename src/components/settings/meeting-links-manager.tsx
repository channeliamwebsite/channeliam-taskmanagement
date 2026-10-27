"use client";

import { ExternalLink, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useDeletionImpact } from "@/components/app/deletion-impact";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createMeetingLink, deleteMeetingLink, getMeetingLinkDeletionImpact, updateMeetingLink } from "@/lib/actions/meetings";
import { TEAM_OPTIONS } from "@/lib/domain";

export type MeetingLinkView = {
  id: string;
  team: string | null;
  title: string;
  url: string;
  schedule: string | null;
  sortOrder: number;
  isActive: boolean;
  kind: "MORNING" | "EVENING" | "OTHER";
  startsAt: string | null;
  meetingDate: string | null;
};

type FormValues = { title: string; url: string; team: string; schedule: string; sortOrder: string; isActive: boolean; kind: MeetingLinkView["kind"]; startsAt: string; meetingDate: string };

const EMPTY: FormValues = { title: "", url: "", team: "", schedule: "", sortOrder: "0", isActive: true, kind: "MORNING", startsAt: "", meetingDate: "" };

const KIND_LABELS = { MORNING: "Morning meeting", EVENING: "Evening meeting", OTHER: "Other meeting" } as const;

function MeetingForm({
  workspaceId,
  link,
  teams,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  link: MeetingLinkView | null;
  teams: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState<FormValues>(
    link
      ? { title: link.title, url: link.url, team: link.team ?? "", schedule: link.schedule ?? "", sortOrder: String(link.sortOrder), isActive: link.isActive, kind: link.kind, startsAt: link.startsAt?.slice(0, 5) ?? "", meetingDate: link.meetingDate ?? "" }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof FormValues>(k: K, v: FormValues[K]) => setValues((s) => ({ ...s, [k]: v }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const input = {
      title: values.title,
      url: values.url,
      team: values.team || null,
      schedule: values.schedule || null,
      sortOrder: Number(values.sortOrder) || 0,
      isActive: values.isActive,
      kind: values.kind,
      startsAt: values.startsAt || null,
      meetingDate: values.meetingDate || null,
    };
    startTransition(async () => {
      const r = link ? await updateMeetingLink(link.id, input) : await createMeetingLink(workspaceId, input);
      if (!r.ok) return setError(r.error);
      toast.success(link ? "Meeting link updated" : "Meeting link added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{link ? "Edit meeting link" : "Add meeting link"}</DialogTitle>
          <DialogDescription>Everyone sees organisation-wide meetings; team meetings show only to that team.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {error ? (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="meeting-title">Meeting name</Label>
            <Input id="meeting-title" value={values.title} onChange={(e) => set("title", e.target.value)} maxLength={200} autoFocus className="h-9" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="meeting-url">Link</Label>
            <Input id="meeting-url" type="url" inputMode="url" placeholder="https://" value={values.url} onChange={(e) => set("url", e.target.value)} className="h-9" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-team">Who</Label>
              <NativeSelect id="meeting-team" value={values.team} onChange={(e) => set("team", e.target.value)}>
                <option value="">Everyone</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t} team
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-schedule">When (optional)</Label>
              <Input id="meeting-schedule" placeholder="e.g. Daily 10:00 AM" value={values.schedule} onChange={(e) => set("schedule", e.target.value)} maxLength={200} className="h-9" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-kind">Type</Label>
              <NativeSelect id="meeting-kind" value={values.kind} onChange={(e) => set("kind", e.target.value as FormValues["kind"])}>
                {(Object.keys(KIND_LABELS) as FormValues["kind"][]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-time">Time (IST)</Label>
              <Input id="meeting-time" type="time" value={values.startsAt} onChange={(e) => set("startsAt", e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-date">Date (empty = daily)</Label>
              <Input id="meeting-date" type="date" value={values.meetingDate} onChange={(e) => set("meetingDate", e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-order">Order</Label>
              <Input id="meeting-order" type="number" value={values.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} className="h-9" />
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={values.isActive} onChange={(e) => set("isActive", e.target.checked)} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MeetingLinksManager({
  workspaceId,
  links,
  memberTeams,
}: {
  workspaceId: string;
  links: MeetingLinkView[];
  memberTeams: string[];
}) {
  const [editing, setEditing] = useState<MeetingLinkView | null | "new">(null);
  const [deleting, setDeleting] = useState<MeetingLinkView | null>(null);
  const [pending, startTransition] = useTransition();
  const impact = useDeletionImpact(Boolean(deleting), () =>
    deleting ? getMeetingLinkDeletionImpact(deleting.id) : Promise.resolve({ ok: true as const, data: { records: 0 } }),
  );
  const records = impact.status === "ready" ? impact.data.records : 0;
  const teams = [...new Set([...TEAM_OPTIONS, ...memberTeams.filter(Boolean)])].sort((a, b) => a.localeCompare(b));

  return (
    <div className="grid gap-3">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No meeting links yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {l.title}
                  {!l.isActive ? <span className="ml-1 text-xs text-muted-foreground">(inactive)</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {KIND_LABELS[l.kind]} · {l.startsAt ? `${l.startsAt.slice(0, 5)} IST · ` : ""}{l.meetingDate ?? "daily"} · {l.team ? `${l.team} team` : "Everyone"}
                  {l.schedule ? ` · ${l.schedule}` : ""}
                </p>
              </div>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${l.title}`}>
                <ExternalLink className="size-4" />
              </a>
              <button type="button" onClick={() => setEditing(l)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${l.title}`}>
                <Pencil className="size-4" />
              </button>
              <button type="button" onClick={() => setDeleting(l)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Delete ${l.title}`}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing("new")}>
        <Plus aria-hidden="true" /> Add meeting link
      </Button>

      {editing ? (
        <MeetingForm
          key={editing === "new" ? "new" : editing.id}
          workspaceId={workspaceId}
          link={editing === "new" ? null : editing}
          teams={teams}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete “${deleting.title}”?` : ""}
        description="This meeting schedule will be removed for everyone. Tasks and people are not affected."
        pending={pending}
        confirmDisabled={impact.status !== "ready"}
        onConfirm={() =>
          startTransition(async () => {
            if (!deleting) return;
            const r = await deleteMeetingLink(deleting.id);
            if (r.ok) {
              toast.success("Meeting link deleted");
              setDeleting(null);
            } else toast.error(r.error);
          })
        }
      >
        {impact.status === "ready" ? (
          records ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
              Also permanently deleted: {records} meeting record{records === 1 ? "" : "s"} (agenda, notes, decisions) for this meeting.
            </p>
          ) : (
            <p className="text-muted-foreground">No meeting records are attached.</p>
          )
        ) : impact.status === "error" ? (
          <p className="text-destructive">{impact.error}</p>
        ) : (
          <p className="text-muted-foreground">Checking meeting records…</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
