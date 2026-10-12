"use client";

import { ChevronRight, CornerDownRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PriorityBadge } from "@/components/app/badges";
import { AvatarStack } from "@/components/app/user-avatar";
import { formatDate, isOverdue, type Priority, type TaskStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

import { ScheduleInput } from "./schedule-input";
import { TaskStatusSelect } from "./task-status-select";

export type TaskRow = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  scheduledDate?: string | null;
  dueDate: string | null;
  progress: number;
  parentTaskId: string | null;
  projectName: string | null;
  clientName?: string | null;
  subtaskTotal?: number;
  subtaskDone?: number;
  assignees: { userId: string; name: string }[];
  canUpdateStatus: boolean;
  /** Optional labels such as "Carried forward" or "Overdue". */
  flags?: { label: string; tone: "red" | "amber" | "blue" }[];
};

type Node = TaskRow & { children: Node[] };

/** Builds a forest; tasks whose parent is not in the list become roots. */
function buildTree(rows: TaskRow[]): Node[] {
  const byId = new Map<string, Node>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.parentTaskId ? byId.get(node.parentTaskId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const GRID =
  "xl:grid-cols-[minmax(14rem,1fr)_minmax(8rem,11rem)_6.5rem_6.5rem_8rem_9rem_6.5rem]";

const TONES = {
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-800",
  blue: "bg-blue-50 text-blue-700",
};

export function TaskList({
  tasks,
  showProject = true,
  today,
}: {
  tasks: TaskRow[];
  showProject?: boolean;
  today: string;
}) {
  const tree = useMemo(() => buildTree(tasks), [tasks]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: Node, depth: number): React.ReactNode {
    const overdue = isOverdue(node.dueDate, node.status, today);
    const isCollapsed = collapsed.has(node.id);
    const total = node.subtaskTotal ?? node.children.length;
    const done = node.subtaskDone ?? node.children.filter((c) => c.status === "COMPLETED").length;
    const where = [node.clientName, node.projectName].filter(Boolean).join(" · ");

    return (
      <li key={node.id}>
        <div
          className={cn(
            "grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2 hover:bg-muted/40",
            GRID,
            depth > 0 && "bg-muted/15",
          )}
        >
          {/* Task */}
          <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${depth * 1.25}rem` }}>
            {node.children.length ? (
              <button
                type="button"
                onClick={() => toggle(node.id)}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                aria-label={isCollapsed ? `Expand ${node.title}` : `Collapse ${node.title}`}
                aria-expanded={!isCollapsed}
              >
                <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
              </button>
            ) : depth > 0 ? (
              <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <div className="min-w-0">
              <Link
                href={`/tasks/${node.id}`}
                className={cn(
                  "block truncate text-sm font-medium hover:underline",
                  node.status === "COMPLETED" && "text-muted-foreground line-through",
                )}
              >
                {node.title}
              </Link>
              <span className="flex flex-wrap items-center gap-1">
                {total ? (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {done}/{total} subtasks done
                  </span>
                ) : null}
                {node.flags?.map((f) => (
                  <span key={f.label} className={cn("rounded px-1.5 py-px text-[11px] font-medium", TONES[f.tone])}>
                    {f.label}
                  </span>
                ))}
                {showProject && where ? <span className="truncate text-[11px] text-muted-foreground xl:hidden">{where}</span> : null}
              </span>
            </div>
          </div>

          {/* Client / project */}
          <div className="hidden min-w-0 xl:block">
            {showProject ? (
              <>
                <span className="block truncate text-xs">{node.projectName ?? "—"}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{node.clientName ?? "Internal"}</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>

          {/* Assignee */}
          <div className="col-start-1 row-start-2 pl-6 xl:col-auto xl:row-auto xl:pl-0">
            <AvatarStack people={node.assignees.map((a) => ({ id: a.userId, name: a.name }))} />
          </div>

          {/* Priority */}
          <div className="hidden xl:block">
            <PriorityBadge priority={node.priority} />
          </div>

          {/* Status */}
          <div className="col-start-2 row-start-1 justify-self-end xl:col-auto xl:row-auto xl:justify-self-start">
            <TaskStatusSelect taskId={node.id} status={node.status} disabled={!node.canUpdateStatus} />
          </div>

          {/* Scheduled */}
          <div className="col-span-2 flex flex-wrap items-center gap-2 pl-6 xl:col-span-1 xl:pl-0">
            <span className="xl:hidden">
              <PriorityBadge priority={node.priority} />
            </span>
            {node.canUpdateStatus && node.status !== "COMPLETED" && node.status !== "CANCELLED" ? (
              <ScheduleInput taskId={node.id} value={node.scheduledDate ?? null} />
            ) : (
              <span className="text-xs text-muted-foreground">{node.scheduledDate ? formatDate(node.scheduledDate) : "—"}</span>
            )}
            <span className={cn("text-xs xl:hidden", overdue ? "font-medium text-red-600" : "text-muted-foreground")}>
              {node.dueDate ? `Due ${formatDate(node.dueDate)}` : ""}
            </span>
          </div>

          {/* Due */}
          <div className={cn("hidden text-xs xl:block", overdue ? "font-medium text-red-600" : "text-muted-foreground")}>
            {node.dueDate ? formatDate(node.dueDate) : "—"}
          </div>
        </div>
        {node.children.length && !isCollapsed ? (
          <ul className="border-t border-dashed">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div
        className={cn(
          "hidden gap-x-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground xl:grid",
          GRID,
        )}
      >
        <span className="pl-6">Task</span>
        <span>Client / project</span>
        <span>Assignee</span>
        <span>Priority</span>
        <span>Status</span>
        <span>Scheduled</span>
        <span>Due</span>
      </div>
      <ul className="divide-y">{tree.map((n) => renderNode(n, 0))}</ul>
    </div>
  );
}
