"use client";

import { CheckCircle2, Loader2, Pencil, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { UserAvatar } from "@/components/app/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteTask, setTaskAssignees, updateTaskProgress, updateTaskStatus } from "@/lib/actions/tasks";
import { ROLE_LABELS } from "@/lib/auth/roles";

import { AssigneePicker, type MemberOption } from "./assignee-picker";
import { TaskFormDialog, type TaskFormValues } from "./task-form-dialog";

export function TaskHeaderActions({
  taskId,
  title,
  isCompleted,
  canManage,
  canUpdateStatus,
  canDelete,
  subtaskCount,
  editValues,
  parentCandidates,
  members,
  redirectTo,
}: {
  taskId: string;
  title: string;
  isCompleted: boolean;
  canManage: boolean;
  canUpdateStatus: boolean;
  canDelete: boolean;
  subtaskCount: number;
  editValues: TaskFormValues;
  parentCandidates: { id: string; title: string }[];
  members: MemberOption[];
  redirectTo: string;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      {canUpdateStatus && !isCompleted ? (
        <Button
          variant="outline"
          className="h-9"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await updateTaskStatus(taskId, "COMPLETED");
              if (r.ok) toast.success("Task completed");
              else toast.error(r.error);
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 aria-hidden="true" />}
          Mark complete
        </Button>
      ) : null}
      {canManage ? (
        <Button variant="outline" className="h-9" onClick={() => setEditOpen(true)}>
          <Pencil aria-hidden="true" /> Edit
        </Button>
      ) : null}
      {canDelete ? (
        <Button variant="destructive" className="h-9" onClick={() => setDeleteOpen(true)}>
          <Trash2 aria-hidden="true" /> Delete
        </Button>
      ) : null}

      {editOpen ? (
        <TaskFormDialog
          mode="edit"
          open={editOpen}
          onOpenChange={setEditOpen}
          taskId={taskId}
          initial={editValues}
          parentCandidates={parentCandidates}
          members={members}
        />
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this task?"
        description={
          subtaskCount
            ? `“${title}” and its ${subtaskCount} subtask${subtaskCount > 1 ? "s" : ""} (including nested ones), comments and history will be permanently deleted.`
            : `“${title}”, its comments and history will be permanently deleted.`
        }
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await deleteTask(taskId);
            if (r.ok) {
              toast.success("Task deleted");
              setDeleteOpen(false);
              router.replace(redirectTo);
            } else toast.error(r.error);
          })
        }
      />
    </>
  );
}

export function AssigneesPanel({
  taskId,
  assignees,
  members,
  canAssign,
}: {
  taskId: string;
  assignees: { userId: string; name: string; isPrimary: boolean; role?: string }[];
  members: MemberOption[];
  canAssign: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openEditor() {
    setSelected(assignees.map((a) => a.userId));
    setPrimary(assignees.find((a) => a.isPrimary)?.userId ?? assignees[0]?.userId ?? null);
    setOpen(true);
  }

  const roleOf = (id: string) => members.find((m) => m.userId === id)?.role;

  return (
    <div>
      {assignees.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one is assigned yet.</p>
      ) : (
        <ul className="grid gap-2">
          {assignees.map((a) => {
            const role = roleOf(a.userId);
            return (
              <li key={a.userId} className="flex items-center gap-2">
                <UserAvatar name={a.name} seed={a.userId} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">{a.name}</span>
                {a.isPrimary ? (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">Primary</span>
                ) : role ? (
                  <span className="text-[11px] text-muted-foreground">{ROLE_LABELS[role]}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canAssign ? (
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={openEditor}>
          <Users aria-hidden="true" /> {assignees.length ? "Reassign / edit" : "Assign people"}
        </Button>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assignees</DialogTitle>
            <DialogDescription>Assign admins or individuals from this workspace. Mark one as primary.</DialogDescription>
          </DialogHeader>
          <AssigneePicker
            members={members}
            selected={selected}
            primaryId={primary}
            disabled={pending}
            onChange={(ids, p) => {
              setSelected(ids);
              setPrimary(p);
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await setTaskAssignees(taskId, selected, primary);
                  if (r.ok) {
                    toast.success("Assignees updated");
                    setOpen(false);
                  } else toast.error(r.error);
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ProgressControl({ taskId, progress, disabled }: { taskId: string; progress: number; disabled: boolean }) {
  const [value, setValue] = useState(progress);
  const [pending, startTransition] = useTransition();
  const dirty = value !== progress;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor="task-progress" className="font-medium">
          Progress
        </label>
        <span className="tabular-nums text-muted-foreground">{value}%</span>
      </div>
      <input
        id="task-progress"
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled || pending}
        onChange={(e) => setValue(Number(e.target.value))}
        className="w-full accent-primary disabled:opacity-60"
      />
      {dirty && !disabled ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await updateTaskProgress(taskId, value);
                if (r.ok) toast.success("Progress updated");
                else {
                  toast.error(r.error);
                  setValue(progress);
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save progress
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setValue(progress)} disabled={pending}>
            Reset
          </Button>
        </div>
      ) : null}
    </div>
  );
}
