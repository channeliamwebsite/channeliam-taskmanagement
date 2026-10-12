"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createTask, getParentTaskOptions, updateTask } from "@/lib/actions/tasks";
import {
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type Priority,
  type TaskStatus,
  type TaskType,
} from "@/lib/domain";

import { AssigneePicker, type MemberOption } from "./assignee-picker";

export type ProjectOption = { id: string; name: string; clientId?: string | null; clientName?: string | null };

export type TaskFormValues = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  startDate: string;
  scheduledDate: string;
  dueDate: string;
  parentTaskId: string;
  /** Not shown in the form; preserved as-is on edit. */
  taskType?: TaskType;
  estimatedHours?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MemberOption[];
} & (
  | {
      mode: "create";
      projects: ProjectOption[];
      defaultProjectId?: string;
      defaultScheduledDate?: string;
      parentTask?: { id: string; title: string; projectId: string } | null;
    }
  | {
      mode: "edit";
      taskId: string;
      initial: TaskFormValues;
      parentCandidates: { id: string; title: string }[];
    }
);

const EMPTY: TaskFormValues = {
  title: "",
  description: "",
  status: "TODO",
  priority: "MEDIUM",
  startDate: "",
  scheduledDate: "",
  dueDate: "",
  parentTaskId: "",
};

const NO_CLIENT = "__none__";

export function TaskFormDialog(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initialValues =
    props.mode === "edit" ? props.initial : { ...EMPTY, scheduledDate: props.defaultScheduledDate ?? "" };
  const [values, setValues] = useState<TaskFormValues>(initialValues);

  const projects = props.mode === "create" ? props.projects : [];
  const initialProject =
    props.mode === "create" ? (props.parentTask?.projectId ?? props.defaultProjectId ?? projects[0]?.id ?? "") : "";
  const [projectId, setProjectId] = useState(initialProject);
  const [clientFilter, setClientFilter] = useState(
    () => projects.find((p) => p.id === initialProject)?.clientId ?? (initialProject ? NO_CLIENT : ""),
  );
  const [parentOptions, setParentOptions] = useState<{ id: string; title: string }[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientMap = new Map<string, string>();
  for (const p of projects) if (p.clientId && p.clientName) clientMap.set(p.clientId, p.clientName);
  const clients = [...clientMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const hasUnclientedProjects = projects.some((p) => !p.clientId);
  const visibleProjects = projects.filter(
    (p) => !clientFilter || (clientFilter === NO_CLIENT ? !p.clientId : p.clientId === clientFilter),
  );

  // Load parent-task choices for the selected project (create mode, not a fixed subtask).
  const loadParents = props.mode === "create" && !props.parentTask && props.open;
  useEffect(() => {
    if (!loadParents || !projectId) return;
    let cancelled = false;
    getParentTaskOptions(projectId).then((r) => {
      if (!cancelled) setParentOptions(r.ok ? r.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [loadParents, projectId]);

  const set = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function reset() {
    setValues(initialValues);
    setAssignees([]);
    setPrimaryId(null);
    setError(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!values.title.trim()) return setError("Title is required.");
    if (values.startDate && values.dueDate && values.dueDate < values.startDate) {
      return setError("Due date cannot be before the start date.");
    }

    startTransition(async () => {
      if (props.mode === "create") {
        if (!projectId) return setError("Choose a project.");
        if (assignees.length === 0) return setError("Assign at least one person.");
        const result = await createTask({
          projectId,
          parentTaskId: props.parentTask?.id ?? (values.parentTaskId || null),
          title: values.title,
          description: values.description,
          status: values.status,
          priority: values.priority,
          startDate: values.startDate || null,
          scheduledDate: values.scheduledDate || null,
          dueDate: values.dueDate || null,
          assigneeIds: assignees,
          primaryAssigneeId: primaryId,
        });
        if (!result.ok) {
          if (result.error.startsWith("Task created")) {
            toast.warning(result.error);
            props.onOpenChange(false);
            reset();
          } else setError(result.error);
          return;
        }
        toast.success(props.parentTask || values.parentTaskId ? "Subtask created" : "Task created", {
          action: { label: "Open", onClick: () => router.push(`/tasks/${result.data.id}`) },
        });
        props.onOpenChange(false);
        reset();
      } else {
        const result = await updateTask(props.taskId, {
          title: values.title,
          description: values.description,
          status: values.status,
          priority: values.priority,
          taskType: values.taskType,
          startDate: values.startDate || null,
          scheduledDate: values.scheduledDate || null,
          dueDate: values.dueDate || null,
          estimatedHours: values.estimatedHours || null,
          parentTaskId: values.parentTaskId || null,
        });
        if (!result.ok) return setError(result.error);
        toast.success("Task updated");
        props.onOpenChange(false);
      }
    });
  }

  const title =
    props.mode === "edit" ? "Edit task" : props.parentTask ? `New subtask of “${props.parentTask.title}”` : "New task";

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open && props.mode === "create") reset();
      }}
    >
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {props.mode === "create" ? "Title and at least one assignee are required." : "Update the task details."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-3.5" noValidate>
          {error ? (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="task-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="task-title"
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={500}
              required
              autoFocus
              className="h-9"
            />
          </div>

          {props.mode === "create" && !props.parentTask ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="task-client">Client</Label>
                <NativeSelect
                  id="task-client"
                  value={clientFilter}
                  onChange={(e) => {
                    const next = e.target.value;
                    setClientFilter(next);
                    const first = projects.find((p) =>
                      !next ? true : next === NO_CLIENT ? !p.clientId : p.clientId === next,
                    );
                    setProjectId(first?.id ?? "");
                    set("parentTaskId", "");
                  }}
                >
                  <option value="">All clients</option>
                  {clients.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                  {hasUnclientedProjects ? <option value={NO_CLIENT}>Internal / no client</option> : null}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="task-project">
                  Project <span className="text-destructive">*</span>
                </Label>
                <NativeSelect
                  id="task-project"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    set("parentTaskId", "");
                  }}
                  required
                >
                  {visibleProjects.length === 0 ? <option value="">No projects available</option> : null}
                  {visibleProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          ) : null}

          {props.mode === "create" && !props.parentTask && parentOptions.length ? (
            <div className="grid gap-1.5">
              <Label htmlFor="task-parent-create">Parent task (optional)</Label>
              <NativeSelect id="task-parent-create" value={values.parentTaskId} onChange={(e) => set("parentTaskId", e.target.value)}>
                <option value="">None (main task)</option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          {props.mode === "edit" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="task-parent">Parent task</Label>
              <NativeSelect id="task-parent" value={values.parentTaskId} onChange={(e) => set("parentTaskId", e.target.value)}>
                <option value="">None (main task)</option>
                {props.parentCandidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="task-description">Description</Label>
            <Textarea
              id="task-description"
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              maxLength={20000}
            />
          </div>

          {props.mode === "create" ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">
                Assignees <span className="text-destructive">*</span>
              </span>
              <AssigneePicker
                members={props.members}
                selected={assignees}
                primaryId={primaryId}
                disabled={pending}
                onChange={(ids, primary) => {
                  setAssignees(ids);
                  setPrimaryId(primary);
                }}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <NativeSelect id="task-priority" value={values.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="task-status">Status</Label>
              <NativeSelect id="task-status" value={values.status} onChange={(e) => set("status", e.target.value as TaskStatus)}>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {TASK_STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="task-start">Start date</Label>
              <Input id="task-start" type="date" value={values.startDate} onChange={(e) => set("startDate", e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="task-scheduled">Scheduled for</Label>
              <Input id="task-scheduled" type="date" value={values.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="task-due">Due date</Label>
              <Input id="task-due" type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="h-9" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {props.mode === "create" ? "Create task" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
