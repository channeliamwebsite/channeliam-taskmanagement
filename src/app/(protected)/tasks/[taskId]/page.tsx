import { ChevronRight, ListTree } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActivityFeed } from "@/components/app/activity-feed";
import { PriorityBadge, ProgressBar, StatusBadge } from "@/components/app/badges";
import { EmptyState, Section } from "@/components/app/page-header";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import { TaskComments } from "@/components/tasks/task-comments";
import { AssigneesPanel, ProgressControl, TaskHeaderActions } from "@/components/tasks/task-detail-controls";
import { ScheduleInput } from "@/components/tasks/schedule-input";
import { TaskList } from "@/components/tasks/task-list";
import { TaskStatusSelect } from "@/components/tasks/task-status-select";
import { listActivity } from "@/lib/data/activity";
import { getParentCandidates, getTask, getTaskComments, toTaskRows, assignedAtOf, priorityTargetInfo } from "@/lib/data/tasks";
import { getWorkspaceMembers } from "@/lib/data/workspace";
import { hasDerivedProgress, taskProgress } from "@/lib/progress";
import { TASK_TYPE_LABELS, displayName, formatDate, formatDateTime, isOverdue, todayISO, PRIORITY_LABELS, formatTargetHours } from "@/lib/domain";

import { getPageContext } from "../../_components/context";

export const metadata: Metadata = { title: "Task" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TaskPage({ params }: PageProps<"/tasks/[taskId]">) {
  const { taskId } = await params;
  if (!UUID.test(taskId)) notFound();

  const { session } = await getPageContext();
  const task = await getTask(taskId, session);
  if (!task) notFound(); // missing or not visible under RLS

  const [comments, activity, members, parentCandidates] = await Promise.all([
    getTaskComments(task.id),
    listActivity({ workspaceId: task.workspaceId, taskId: task.id, limit: 30 }),
    getWorkspaceMembers(task.workspaceId),
    task.permissions.canManage ? getParentCandidates(task.projectId, task.id) : Promise.resolve([]),
  ]);

  const memberOptions = members.map((m) => ({
    userId: m.userId,
    name: displayName({ full_name: m.fullName, email: m.email }),
    role: m.role,
    isActive: m.isActive,
    team: m.team,
  }));
  const names = new Map(memberOptions.map((m) => [m.userId, m.name]));
  const today = todayISO();
  const targetInfo = priorityTargetInfo(task);
  const overdue = isOverdue(task.dueDate, task.status, today);
  const { canManage, canUpdateStatus, canDelete } = task.permissions;
  const canAssign = canManage && session.profile.role !== "INDIVIDUAL";

  return (
    <div className="grid gap-6">
      <div>
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {task.clientId && task.clientName ? (
            <>
              <Link href={`/clients/${task.clientId}`} className="hover:text-foreground hover:underline">
                {task.clientName}
              </Link>
              <ChevronRight className="size-3" aria-hidden="true" />
            </>
          ) : null}
          <Link href={`/projects/${task.projectId}`} className="hover:text-foreground hover:underline">
            {task.projectName ?? "Project"}
          </Link>
          {task.ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <ChevronRight className="size-3" aria-hidden="true" />
              <Link href={`/tasks/${a.id}`} className="hover:text-foreground hover:underline">
                {a.title}
              </Link>
            </span>
          ))}
        </nav>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{task.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{TASK_TYPE_LABELS[task.taskType]}</span>
              {overdue ? <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Overdue</span> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <TaskHeaderActions
              taskId={task.id}
              title={task.title}
              isCompleted={task.status === "COMPLETED"}
              canManage={canManage}
              canUpdateStatus={canUpdateStatus}
              canDelete={canDelete}
              subtaskCount={task.subtasks.length}
              members={memberOptions}
              parentCandidates={parentCandidates}
              redirectTo={task.parent ? `/tasks/${task.parent.id}` : `/projects/${task.projectId}`}
              editValues={{
                title: task.title,
                description: task.description ?? "",
                status: task.status,
                priority: task.priority,
                taskType: task.taskType,
                startDate: task.startDate ?? "",
                scheduledDate: task.scheduledDate ?? "",
                dueDate: task.dueDate ?? "",
                estimatedHours: task.estimatedHours?.toString() ?? "",
                parentTaskId: task.parentTaskId ?? "",
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Section title="Description">
            {task.description ? (
              <p className="text-sm whitespace-pre-wrap break-words">{task.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
          </Section>

          <Section
            title={`Subtasks${task.subtasks.length ? ` (${task.subtasks.length})` : ""}`}
            action={
              canManage || task.createdBy === session.user.id ? (
                <NewTaskButton
                  projects={[]}
                  members={memberOptions}
                  selfOnly={session.permissions.assignTasks ? null : { userId: session.user.id }}
                  parentTask={{ id: task.id, title: task.title, projectId: task.projectId }}
                  variant="outline"
                  size="sm"
                />
              ) : null
            }
          >
            {task.subtasks.length ? (
              <TaskList tasks={toTaskRows(task.subtasks, session)} showProject={false} today={today} />
            ) : (
              <EmptyState icon={ListTree} title="No subtasks" description="Break this task into smaller steps." className="py-6" />
            )}
          </Section>

          <Section title={`Comments${comments.length ? ` (${comments.length})` : ""}`}>
            <TaskComments
              taskId={task.id}
              comments={comments}
              currentUserId={session.user.id}
              canModerate={canManage}
            />
          </Section>

          <Section title="Activity">
            <ActivityFeed items={activity} names={names} showTarget={false} />
          </Section>
        </div>

        <aside className="grid content-start gap-6">
          <Section title="Details">
            <dl className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <TaskStatusSelect taskId={task.id} status={task.status} disabled={!canUpdateStatus} />
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Start date</dt>
                <dd>{formatDate(task.startDate)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Scheduled for</dt>
                <dd>
                  {canUpdateStatus ? (
                    <ScheduleInput taskId={task.id} value={task.scheduledDate} />
                  ) : (
                    formatDate(task.scheduledDate)
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Due date</dt>
                <dd className={overdue ? "font-medium text-red-600" : undefined}>{formatDate(task.dueDate)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Estimate</dt>
                <dd>{task.estimatedHours != null ? `${task.estimatedHours} h` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Logged</dt>
                <dd>{task.actualHours} h</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Assigned</dt>
                <dd>{formatDateTime(assignedAtOf(task))}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Priority target</dt>
                <dd
                  className={targetInfo.missed ? "font-medium text-red-600" : undefined}
                  title={`${PRIORITY_LABELS[task.priority]}: within ${formatTargetHours(task.priority)} of assignment`}
                >
                  {formatDateTime(targetInfo.target?.toISOString())}
                  {targetInfo.missed ? " (missed)" : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Created by</dt>
                <dd className="truncate">{task.creatorName ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{formatDateTime(task.createdAt)}</dd>
              </div>
            </dl>
            <div className="mt-4 border-t pt-4">
              {hasDerivedProgress(task) ? (
                // Parent tasks: progress follows their subtasks; no manual slider.
                <div className="grid gap-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">Progress</span>
                    <span className="text-muted-foreground">{taskProgress(task)}%</span>
                  </div>
                  <ProgressBar value={taskProgress(task)} />
                  <p className="text-xs text-muted-foreground">
                    From subtasks: {task.subtaskDone} of {task.subtaskTotal} completed
                  </p>
                </div>
              ) : canUpdateStatus ? (
                <ProgressControl key={task.progress} taskId={task.id} progress={task.progress} disabled={!canUpdateStatus} />
              ) : (
                <div className="grid gap-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">Progress</span>
                    <span className="text-muted-foreground">{taskProgress(task)}%</span>
                  </div>
                  <ProgressBar value={taskProgress(task)} />
                </div>
              )}
            </div>
          </Section>

          <Section title="Assignees">
            <AssigneesPanel
              taskId={task.id}
              members={memberOptions}
              canAssign={canAssign}
              assignees={task.assignees.map((a) => ({
                userId: a.userId,
                isPrimary: a.isPrimary,
                name: a.fullName || a.email || "Unknown user",
              }))}
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}
