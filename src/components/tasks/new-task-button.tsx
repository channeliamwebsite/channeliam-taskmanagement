"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { MemberOption } from "./assignee-picker";
import { TaskFormDialog, type ProjectOption } from "./task-form-dialog";

export function NewTaskButton({
  projects,
  members,
  workspaceId,
  selfOnly,
  defaultProjectId,
  defaultScheduledDate,
  parentTask,
  label,
  variant = "default",
  size = "default",
}: {
  projects: ProjectOption[];
  members: MemberOption[];
  workspaceId?: string;
  /** Individuals: create a task assigned only to this user. */
  selfOnly?: { userId: string } | null;
  defaultProjectId?: string;
  defaultScheduledDate?: string;
  parentTask?: { id: string; title: string; projectId: string } | null;
  label?: string;
  variant?: "default" | "outline";
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className={size === "default" ? "h-9" : undefined}>
        <Plus aria-hidden="true" />
        {label ?? (parentTask ? "Add subtask" : "New task")}
      </Button>
      {open ? (
        <TaskFormDialog
          mode="create"
          open={open}
          onOpenChange={setOpen}
          projects={projects}
          members={members}
          workspaceId={workspaceId}
          selfOnly={selfOnly}
          defaultProjectId={defaultProjectId}
          defaultScheduledDate={defaultScheduledDate}
          parentTask={parentTask}
        />
      ) : null}
    </>
  );
}
