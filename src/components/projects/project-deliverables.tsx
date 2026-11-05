import Link from "next/link";

import { PriorityBadge, StatusBadge } from "@/components/app/badges";
import type { MemberOption } from "@/components/tasks/assignee-picker";
import { NewTaskButton } from "@/components/tasks/new-task-button";
import type { TaskSummary } from "@/lib/data/tasks";
import { formatDate } from "@/lib/domain";

/**
 * A project's open main tasks with a "Subtask" button each, used on the client
 * page (inside each expanded project) and on the project page. Subtasks go
 * through the same dialog and createTask action as every other entry point.
 */
export function ProjectDeliverables({
  project,
  workspaceId,
  tasks,
  members,
  selfOnly,
  canAddSubtask,
  limit = 25,
}: {
  project: { id: string; name: string; clientId: string | null; clientName: string | null };
  workspaceId: string;
  /** The project's open main tasks (no parent). */
  tasks: TaskSummary[];
  members: MemberOption[];
  selfOnly: { userId: string } | null;
  /** UI hint only; createTask enforces who may add subtasks. */
  canAddSubtask: (t: TaskSummary) => boolean;
  limit?: number;
}) {
  const sorted = [...tasks].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const projectOption = [{ id: project.id, name: project.name, clientId: project.clientId, clientName: project.clientName }];
  if (!sorted.length) return <p className="text-xs text-muted-foreground">No open tasks.</p>;
  return (
    <ul className="grid gap-1.5">
      {sorted.slice(0, limit).map((t) => (
        <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
          <span className="min-w-0">
            <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">
              {t.title}
            </Link>
            <span className="ml-2 text-xs text-muted-foreground">
              {t.subtaskTotal ? `${t.subtaskDone}/${t.subtaskTotal} subtasks · ` : ""}
              {t.dueDate ? `due ${formatDate(t.dueDate)}` : "no due date"}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <PriorityBadge priority={t.priority} />
            <StatusBadge status={t.status} />
            {canAddSubtask(t) ? (
              <NewTaskButton
                projects={projectOption}
                members={members}
                workspaceId={workspaceId}
                selfOnly={selfOnly}
                parentTask={{ id: t.id, title: t.title, projectId: project.id }}
                label="Subtask"
                variant="outline"
                size="sm"
              />
            ) : null}
          </span>
        </li>
      ))}
      {sorted.length > limit ? (
        <li className="text-xs">
          <Link href={`/projects/${project.id}`} className="text-muted-foreground hover:underline">
            {sorted.length - limit} more on the project page
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
