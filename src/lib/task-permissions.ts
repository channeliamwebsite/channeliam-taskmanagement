// Who may manage a task (edit it, change its assignees, add subtasks under it).
// Mirrors private.can_manage_task (migrations 002 and 025: super admins manage
// every task, in any workspace); the database stays authoritative and refuses
// anything this lets through by mistake.

import type { UserRole } from "@/lib/auth/roles";

export type TaskManageFacts = {
  createdBy: string | null;
  projectOwnerId: string | null;
  projectCreatedBy: string | null;
  assignees: { userId: string; assignedBy: string | null }[];
};

export function canManageTaskAs(role: UserRole, userId: string, task: TaskManageFacts) {
  if (role === "SUPER_ADMIN") return true;
  if (role !== "ADMIN") return false;
  return (
    task.createdBy === userId ||
    task.projectOwnerId === userId ||
    task.projectCreatedBy === userId ||
    task.assignees.some((a) => a.userId === userId || a.assignedBy === userId)
  );
}
