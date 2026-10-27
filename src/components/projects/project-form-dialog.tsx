"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { ImpactSummary, useDeletionImpact } from "@/components/app/deletion-impact";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createProject, deleteProject, getProjectDeletionImpact, updateProject } from "@/lib/actions/projects";
import { describeImpact } from "@/lib/deletion";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type Priority,
  type ProjectStatus,
} from "@/lib/domain";

export type ProjectFormValues = {
  name: string;
  description: string;
  clientName: string;
  clientId: string;
  status: ProjectStatus;
  priority: Priority;
  startDate: string;
  dueDate: string;
  ownerId: string;
};

const EMPTY: ProjectFormValues = {
  name: "",
  description: "",
  clientName: "",
  clientId: "",
  status: "PLANNING",
  priority: "MEDIUM",
  startDate: "",
  dueDate: "",
  ownerId: "",
};

export function ProjectFormButton({
  mode,
  workspaceId,
  projectId,
  initial,
  owners,
  clients,
}: {
  mode: "create" | "edit";
  workspaceId: string;
  projectId?: string;
  initial?: ProjectFormValues;
  owners: { userId: string; name: string }[];
  clients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ProjectFormValues>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof ProjectFormValues>(k: K, v: ProjectFormValues[K]) => setValues((s) => ({ ...s, [k]: v }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!values.name.trim()) return setError("Project name is required.");
    if (values.startDate && values.dueDate && values.dueDate < values.startDate) {
      return setError("Due date cannot be before the start date.");
    }
    const input = {
      name: values.name,
      description: values.description,
      clientId: values.clientId || null,
      clientName: clients.find((cl) => cl.id === values.clientId)?.name ?? (values.clientId ? values.clientName : null),
      status: values.status,
      priority: values.priority,
      startDate: values.startDate || null,
      dueDate: values.dueDate || null,
      ownerId: values.ownerId || null,
    };
    startTransition(async () => {
      if (mode === "create") {
        const r = await createProject(workspaceId, input);
        if (!r.ok) return setError(r.error);
        toast.success("Project created");
        setOpen(false);
        setValues(EMPTY);
        router.push(`/projects/${r.data.id}`);
      } else {
        const r = await updateProject(projectId!, input);
        if (!r.ok) return setError(r.error);
        toast.success("Project updated");
        setOpen(false);
      }
    });
  }

  return (
    <>
      {mode === "create" ? (
        <Button className="h-9" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" /> New project
        </Button>
      ) : (
        <Button
          variant="outline"
          className="h-9"
          onClick={() => {
            setValues(initial ?? EMPTY);
            setError(null);
            setOpen(true);
          }}
        >
          <Pencil aria-hidden="true" /> Edit project
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "New project" : "Edit project"}</DialogTitle>
            <DialogDescription>Projects group related tasks for a client or initiative.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input id="project-name" value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoFocus className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="project-client">Client</Label>
              <NativeSelect id="project-client" value={values.clientId} onChange={(e) => set("clientId", e.target.value)}>
                <option value="">No client (internal)</option>
                {clients.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.name}
                  </option>
                ))}
              </NativeSelect>
              {clients.length === 0 ? <p className="text-xs text-muted-foreground">Add clients on the Clients page.</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="project-description">Description</Label>
              <Textarea id="project-description" value={values.description} onChange={(e) => set("description", e.target.value)} rows={3} maxLength={5000} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="project-status">Status</Label>
                <NativeSelect id="project-status" value={values.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="project-priority">Priority</Label>
                <NativeSelect id="project-priority" value={values.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="project-start">Start date</Label>
                <Input id="project-start" type="date" value={values.startDate} onChange={(e) => set("startDate", e.target.value)} className="h-9" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="project-due">Due date</Label>
                <Input id="project-due" type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="h-9" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="project-owner">Owner</Label>
              <NativeSelect id="project-owner" value={values.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
                <option value="">No owner</option>
                {owners.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {mode === "create" ? "Create project" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const impact = useDeletionImpact(open, () => getProjectDeletionImpact(projectId));
  return (
    <>
      <Button variant="destructive" className="h-9" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" /> Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete “${name}”?`}
        description="The project and all of its own tasks will be permanently deleted. Other projects, clients and people are not affected. Consider archiving instead."
        pending={pending}
        confirmDisabled={impact.status !== "ready"}
        onConfirm={() =>
          startTransition(async () => {
            const r = await deleteProject(projectId);
            if (r.ok) {
              toast.success("Project deleted");
              setOpen(false);
              router.replace("/projects");
            } else toast.error(r.error);
          })
        }
      >
        <ImpactSummary
          state={impact}
          lines={impact.status === "ready" ? describeImpact(impact.data) : []}
          empty="The project has no tasks."
        />
      </ConfirmDialog>
    </>
  );
}
