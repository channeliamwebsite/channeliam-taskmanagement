"use client";

import { ChevronRight, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";

import { AssigneePicker, type MemberOption } from "./assignee-picker";

export type ProjectOption = {
  id: string;
  name: string;
  clientId?: string | null;
  clientName?: string | null;
  /** The workspace's General project (used when no project is chosen). */
  isDefault?: boolean;
};

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
      workspaceId?: string;
      projects: ProjectOption[];
      defaultProjectId?: string;
      defaultScheduledDate?: string;
      parentTask?: { id: string; title: string; projectId: string } | null;
      /** Individuals: the task is always assigned to this user only. */
      selfOnly?: { userId: string } | null;
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
/** Project select value meaning "use the workspace's General project". */
const GENERAL = "";

export function TaskFormDialog(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initialValues =
    props.mode === "edit" ? props.initial : { ...EMPTY, scheduledDate: props.defaultScheduledDate ?? "" };
  const [values, setValues] = useState<TaskFormValues>(initialValues);

  const isCreate = props.mode === "create";
  const projects = props.mode === "create" ? props.projects : [];
  const selfOnly = props.mode === "create" ? (props.selfOnly ?? null) : null;
  const generalProject = projects.find((p) => p.isDefault);
  const presetProject = props.mode === "create" ? (props.parentTask?.projectId ?? props.defaultProjectId ?? "") : "";
  const initialProject = presetProject && presetProject !== generalProject?.id ? presetProject : GENERAL;
  const [projectId, setProjectId] = useState(initialProject);
  const [clientFilter, setClientFilter] = useState(
    () => projects.find((p) => p.id === initialProject)?.clientId ?? "",
  );
  // Everyday tasks only need the basics; project/client/parent/status/start
  // stay available behind "More options".
  const [showMore, setShowMore] = useState(initialProject !== GENERAL);
  const [parentOptions, setParentOptions] = useState<{ id: string; title: string }[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientMap = new Map<string, string>();
  for (const p of projects) if (p.clientId && p.clientName) clientMap.set(p.clientId, p.clientName);
  const clients = [...clientMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const otherProjects = projects.filter((p) => !p.isDefault);
  const hasUnclientedProjects = otherProjects.some((p) => !p.clientId);
  const visibleProjects = otherProjects.filter(
    (p) => !clientFilter || (clientFilter === NO_CLIENT ? !p.clientId : p.clientId === clientFilter),
  );
  const effectiveProjectId = projectId || generalProject?.id || "";

  // Parent-task choices for the chosen project (admins, create mode, when expanded).
  const loadParents = props.mode === "create" && !props.parentTask && !selfOnly && props.open && showMore;
  useEffect(() => {
    if (!loadParents || !effectiveProjectId) return;
    let cancelled = false;
    getParentTaskOptions(effectiveProjectId).then((r) => {
      if (!cancelled) setParentOptions(r.ok ? r.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [loadParents, effectiveProjectId]);

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
        if (!selfOnly && assignees.length === 0) return setError("Assign at least one person.");
        const result = await createTask({
          projectId: props.parentTask?.projectId ?? (projectId || null),
          workspaceId: props.workspaceId ?? null,
          parentTaskId: props.parentTask?.id ?? (values.parentTaskId || null),
          title: values.title,
          description: values.description,
          status: values.status,
          priority: values.priority,
          startDate: values.startDate || null,
          scheduledDate: values.scheduledDate || null,
          dueDate: values.dueDate || null,
          assigneeIds: selfOnly ? [selfOnly.userId] : assignees,
          primaryAssigneeId: selfOnly ? selfOnly.userId : primaryId,
        });
        if (!result.ok) return setError(result.error);
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

  const priorityField = (
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
  );
  const statusField = (
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
  );
  const startField = (
    <div className="grid gap-1.5">
      <Label htmlFor="task-start">Start date</Label>
      <Input id="task-start" type="date" value={values.startDate} onChange={(e) => set("startDate", e.target.value)} className="h-9" />
    </div>
  );
  const scheduledField = (
    <div className="grid gap-1.5">
      <Label htmlFor="task-scheduled">Scheduled for</Label>
      <Input id="task-scheduled" type="date" value={values.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} className="h-9" />
    </div>
  );
  const dueField = (
    <div className="grid gap-1.5">
      <Label htmlFor="task-due">Due date</Label>
      <Input id="task-due" type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="h-9" />
    </div>
  );
  const descriptionField = (
    <div className="grid gap-1.5">
      <Label htmlFor="task-description">Description</Label>
      <Textarea id="task-description" value={values.description} onChange={(e) => set("description", e.target.value)} rows={3} maxLength={20000} />
    </div>
  );

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
            {isCreate
              ? selfOnly
                ? "Add a task for yourself. Leave the date empty to plan it for today."
                : "Title and at least one assignee are required. Leave the date empty to plan it for today."
              : "Update the task details."}
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

          {props.mode === "create" ? (
            selfOnly ? (
              <p className="text-sm text-muted-foreground">Assigned to you.</p>
            ) : (
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
            )
          ) : null}

          {props.mode === "create" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {scheduledField}
                {dueField}
                {priorityField}
              </div>
              {descriptionField}

              {!props.parentTask && !selfOnly ? (
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={() => setShowMore((v) => !v)}
                    className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                    aria-expanded={showMore}
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", showMore && "rotate-90")} aria-hidden="true" />
                    More options
                    <span className="text-xs">
                      ({projectId ? projects.find((p) => p.id === projectId)?.name : (generalProject?.name ?? "General")})
                    </span>
                  </button>
                  {showMore ? (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor="task-client">Client</Label>
                          <NativeSelect
                            id="task-client"
                            value={clientFilter}
                            onChange={(e) => {
                              setClientFilter(e.target.value);
                              setProjectId(GENERAL);
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
                          <Label htmlFor="task-project">Project</Label>
                          <NativeSelect
                            id="task-project"
                            value={projectId}
                            onChange={(e) => {
                              setProjectId(e.target.value);
                              set("parentTaskId", "");
                            }}
                          >
                            <option value={GENERAL}>{generalProject?.name ?? "General"} (default)</option>
                            {visibleProjects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </div>
                      </div>
                      {parentOptions.length ? (
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
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {statusField}
                        {startField}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <>
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
              {descriptionField}
              <div className="grid grid-cols-2 gap-3">
                {priorityField}
                {statusField}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {startField}
                {scheduledField}
                {dueField}
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {isCreate ? "Create task" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
