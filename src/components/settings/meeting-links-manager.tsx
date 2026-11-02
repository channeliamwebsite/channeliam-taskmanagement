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
import { Textarea } from "@/components/ui/textarea";
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
  description: string | null;
  endsAt: string | null;
  createdBy: string | null;
  participantIds: string[];
};

/** Someone who can be invited: an active member of the workspace. */
export type ParticipantOption = { userId: string; name: string };

type FormValues = {
  title: string;
  url: string;
  team: string;
  schedule: string;
  sortOrder: string;
  isActive: boolean;
  kind: MeetingLinkView["kind"];
  startsAt: string;
  endsAt: string;
  meetingDate: string;
  description: string;
  participantIds: string[];
};

const EMPTY: FormValues = {
  title: "",
  url: "",
  team: "",
  schedule: "",
  sortOrder: "0",
  isActive: true,
  kind: "MORNING",
  startsAt: "",
  endsAt: "",
  meetingDate: "",
  description: "",
  participantIds: [],
};

const KIND_LABELS = { MORNING: "Morning meeting", EVENING: "Evening meeting", OTHER: "Other meeting" } as const;

function MeetingForm({
  workspaceId,
  link,
  teams,
  people,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  link: MeetingLinkView | null;
  teams: string[];
  people: ParticipantOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState<FormValues>(
    link
      ? {
          title: link.title,
          url: link.url,
          team: link.team ?? "",
          schedule: link.schedule ?? "",
          sortOrder: String(link.sortOrder),
          isActive: link.isActive,
          kind: link.kind,
          startsAt: link.startsAt?.slice(0, 5) ?? "",
          endsAt: link.endsAt?.slice(0, 5) ?? "",
          meetingDate: link.meetingDate ?? "",
          description: link.description ?? "",
          participantIds: link.participantIds,
        }
      : EMPTY,
  );
  const toggleParticipant = (id: string) =>
    setValues((s) => ({
      ...s,
      participantIds: s.participantIds.includes(id) ? s.participantIds.filter((p) => p !== id) : [...s.participantIds, id],
    }));
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
      endsAt: values.endsAt || null,
      meetingDate: values.meetingDate || null,
      description: values.description || null,
      participantIds: values.participantIds,
    };
    startTransition(async () => {
      const r = link ? await updateMeetingLink(link.id, input) : await createMeetingLink(workspaceId, input);
      if (!r.ok) return setError(r.error);
      toast.success(link ? "Meeting updated" : "Meeting scheduled");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{link ? "Edit meeting" : "Schedule a meeting"}</DialogTitle>
          <DialogDescription>
            Invite people by name, or leave the list empty to show the meeting to everyone or one team. Invited people get an
            in-app notification.
          </DialogDescription>
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
            <Label htmlFor="meeting-description">Description (optional)</Label>
            <Textarea id="meeting-description" value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={2000} rows={2} />
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <Label htmlFor="meeting-date">Date (empty = daily)</Label>
              <Input id="meeting-date" type="date" value={values.meetingDate} onChange={(e) => set("meetingDate", e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-time">Starts (workspace time)</Label>
              <Input id="meeting-time" type="time" value={values.startsAt} onChange={(e) => set("startsAt", e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="meeting-end">Ends (optional)</Label>
              <Input id="meeting-end" type="time" value={values.endsAt} onChange={(e) => set("endsAt", e.target.value)} className="h-9" />
            </div>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Participants ({values.participantIds.length})</legend>
            {people.length ? (
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                {people.map((p) => (
                  <label key={p.userId} className="flex min-w-0 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-primary"
                      checked={values.participantIds.includes(p.userId)}
                      onChange={() => toggleParticipant(p.userId)}
                    />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No members to invite yet.</p>
            )}
          </fieldset>
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
  people,
  manageableIds,
}: {
  workspaceId: string;
  links: MeetingLinkView[];
  memberTeams: string[];
  /** Active members of the workspace who can be invited. */
  people: ParticipantOption[];
  /** Meetings the viewer may edit or delete (mirrors RLS, 029). */
  manageableIds: string[];
}) {
  const [editing, setEditing] = useState<MeetingLinkView | null | "new">(null);
  const [deleting, setDeleting] = useState<MeetingLinkView | null>(null);
  const [pending, startTransition] = useTransition();
  const impact = useDeletionImpact(Boolean(deleting), () =>
    deleting ? getMeetingLinkDeletionImpact(deleting.id) : Promise.resolve({ ok: true as const, data: { records: 0 as number | null } }),
  );
  // null: the viewer cannot see meeting records (admins), so the count is unknown.
  const records = impact.status === "ready" ? impact.data.records : null;
  const teams = [...new Set([...TEAM_OPTIONS, ...memberTeams.filter(Boolean)])].sort((a, b) => a.localeCompare(b));

  return (
    <div className="grid gap-3">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No meetings scheduled yet.</p>
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
                  {KIND_LABELS[l.kind]} · {l.startsAt ? `${l.startsAt.slice(0, 5)}${l.endsAt ? `–${l.endsAt.slice(0, 5)}` : ""} · ` : ""}
                  {l.meetingDate ?? "daily"} ·{" "}
                  {l.participantIds.length
                    ? `${l.participantIds.length} participant${l.participantIds.length === 1 ? "" : "s"}`
                    : l.team
                      ? `${l.team} team`
                      : "Everyone"}
                  {l.schedule ? ` · ${l.schedule}` : ""}
                </p>
              </div>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${l.title}`}>
                <ExternalLink className="size-4" />
              </a>
              {manageableIds.includes(l.id) ? (
                <>
                  <button type="button" onClick={() => setEditing(l)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${l.title}`}>
                    <Pencil className="size-4" />
                  </button>
                  <button type="button" onClick={() => setDeleting(l)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Delete ${l.title}`}>
                    <Trash2 className="size-4" />
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing("new")}>
        <Plus aria-hidden="true" /> Schedule a meeting
      </Button>

      {editing ? (
        <MeetingForm
          key={editing === "new" ? "new" : editing.id}
          workspaceId={workspaceId}
          link={editing === "new" ? null : editing}
          teams={teams}
          people={people}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete “${deleting.title}”?` : ""}
        description="This meeting will be removed for everyone. A meeting with recorded notes or decisions cannot be deleted; deactivate it instead (edit it and untick Active)."
        pending={pending}
        confirmDisabled={impact.status !== "ready" || (records !== null && records > 0)}
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
          records === null ? (
            <p className="text-muted-foreground">
              Meeting notes are visible to super admins only. If this meeting has any, deleting it will be refused so they are
              kept.
            </p>
          ) : records > 0 ? (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              This meeting has {records} meeting record{records === 1 ? "" : "s"} (agenda, notes, decisions), so it cannot be deleted.
              Deactivate it instead to keep its history.
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
