// Three separate mirrors of the database's task-authorization functions
// (Phase 2, migrations 044-046); the database stays authoritative and
// refuses anything these let through by mistake.
//
// - canManageTaskAs mirrors private.can_manage_task: Admin's ownership-based
//   rule only (super admins manage every task "since 025" is no longer true
//   as of 046 - Super Admin is monitoring-only). Gates subtask-parent
//   eligibility and comment/attachment moderation, unchanged for Admin.
// - canAssignTaskAs mirrors private.can_assign_task: Admin's rule above, plus
//   an unrestricted Operational Manager branch (company-wide assignment).
// - canEditOrDeleteOwnTaskAs mirrors private.can_edit_or_delete_own_task:
//   Admin's rule above, plus Operational Manager limited to tasks they
//   personally created.

import type { UserRole } from "@/lib/auth/roles";

export type TaskManageFacts = {
  createdBy: string | null;
  projectOwnerId: string | null;
  projectCreatedBy: string | null;
  assignees: { userId: string; assignedBy: string | null }[];
};

function adminOwnsTask(userId: string, task: TaskManageFacts) {
  return (
    task.createdBy === userId ||
    task.projectOwnerId === userId ||
    task.projectCreatedBy === userId ||
    task.assignees.some((a) => a.userId === userId || a.assignedBy === userId)
  );
}

export function canManageTaskAs(role: UserRole, userId: string, task: TaskManageFacts) {
  if (role !== "ADMIN") return false;
  return adminOwnsTask(userId, task);
}

export function canAssignTaskAs(role: UserRole, userId: string, task: TaskManageFacts) {
  if (role === "OPERATIONAL_MANAGER") return true;
  return canManageTaskAs(role, userId, task);
}

export function canEditOrDeleteOwnTaskAs(role: UserRole, userId: string, task: TaskManageFacts) {
  if (role === "OPERATIONAL_MANAGER") return task.createdBy === userId;
  return canManageTaskAs(role, userId, task);
}
