// Pure helpers behind the task queries in data/tasks.ts: keyset pagination,
// in-memory ordering and assignee-filter construction. No I/O (unit-tested).

import type { Priority } from "./domain.ts";

/**
 * Rows per request. Must not exceed the API's max_rows (Supabase default and
 * supabase/config.toml: 1000), otherwise a short page would look like the end.
 */
export const PAGE_SIZE = 1000;

/** Upper bound on ids per `.in()` filter, keeping request URLs short. */
export const IN_CHUNK = 200;

type Page<Row> = { data: Row[] | null; error: unknown };

/**
 * Loads every row by walking the primary key (`id > cursor`, ascending) until
 * a page comes back short. Unlike offset paging, rows updated or re-sorted
 * while paging cannot be skipped or repeated, because their id never changes.
 */
export async function fetchAllPages<Row extends { id: string }>(
  fetchPage: (afterId: string | null) => PromiseLike<Page<Row>>,
  errorMessage: string,
  pageSize = PAGE_SIZE,
): Promise<Row[]> {
  const rows: Row[] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error } = await fetchPage(after);
    if (error || !data) {
      // Server-side log with the database error code and message only.
      const e = (error ?? {}) as { code?: string; message?: string };
      console.error(`[data] ${errorMessage}:`, e.code ?? "no-code", e.message ?? "no data returned");
      throw new Error(errorMessage);
    }
    rows.push(...data);
    if (data.length < pageSize) return rows;
    after = data[data.length - 1].id;
  }
}

/** Splits ids into chunks for `.in()` filters. */
export function chunk<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Keeps the first occurrence of each id (e.g. when merging two queries). */
export function uniqueById<Row extends { id: string }>(rows: readonly Row[]): Row[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

export type TaskSort = "updated" | "due" | "start" | "priority";

type Sortable = {
  id: string;
  updated_at: string;
  due_date: string | null;
  start_date: string | null;
  priority: Priority;
};

const PRIORITY_RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/**
 * The ordering the database used to apply: the chosen key (dates ascending,
 * nulls last; priority most urgent first), then most recently updated, then
 * id so equal rows keep a stable order.
 */
export function sortTaskRows<Row extends Sortable>(rows: Row[], sort: TaskSort = "updated"): Row[] {
  const date = (v: string | null) => v ?? "￿";
  const primary = (a: Row, b: Row) =>
    sort === "due"
      ? date(a.due_date).localeCompare(date(b.due_date))
      : sort === "start"
        ? date(a.start_date).localeCompare(date(b.start_date))
        : sort === "priority"
          ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
          : 0;
  return [...rows].sort(
    (a, b) => primary(a, b) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
  );
}

/**
 * Assignee filters as inner-joined, aliased embeds of task_assignees. Each
 * filter gets its own alias, so "assigned to X" and "assigned to someone in
 * the department" are independent conditions (both must hold), and neither
 * narrows the `assignees` embed shown in the UI. A task matches once however
 * many of its assignees match.
 */
export function assigneeFilters(filters: { assigneeId?: string; assigneeIds?: string[] }) {
  const embeds: string[] = [];
  const conditions: { column: string; op: "eq" | "in"; value: string | string[] }[] = [];
  if (filters.assigneeId) {
    embeds.push("fa:task_assignees!task_assignees_task_id_fkey!inner(user_id)");
    conditions.push({ column: "fa.user_id", op: "eq", value: filters.assigneeId });
  }
  if (filters.assigneeIds) {
    embeds.push("fd:task_assignees!task_assignees_task_id_fkey!inner(user_id)");
    conditions.push({ column: "fd.user_id", op: "in", value: filters.assigneeIds });
  }
  return { embeds, conditions };
}
