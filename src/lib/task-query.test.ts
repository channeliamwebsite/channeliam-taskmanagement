import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assigneeFilters, chunk, fetchAllPages, sortTaskRows, uniqueById } from "./task-query.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A fake table served in id order, `pageSize` rows at a time, like `id > cursor order by id limit n`. */
function fakeTable(count: number, pageSize: number) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: id(i + 1) }));
  const cursors: (string | null)[] = [];
  const fetchPage = async (after: string | null) => {
    cursors.push(after);
    const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0;
    return { data: rows.slice(start, start + pageSize), error: null };
  };
  return { rows, cursors, fetchPage };
}

describe("fetchAllPages (keyset pagination)", () => {
  it("returns an empty list after one request when nothing matches", async () => {
    const t = fakeTable(0, 1000);
    assert.deepEqual(await fetchAllPages(t.fetchPage, "x", 1000), []);
    assert.deepEqual(t.cursors, [null]);
  });

  it("stops after a single short page", async () => {
    const t = fakeTable(999, 1000);
    assert.equal((await fetchAllPages(t.fetchPage, "x", 1000)).length, 999);
    assert.equal(t.cursors.length, 1);
  });

  it("does not stop at the 1,000-row page limit", async () => {
    const t = fakeTable(2500, 1000);
    const rows = await fetchAllPages(t.fetchPage, "x", 1000);
    assert.equal(rows.length, 2500);
    assert.equal(new Set(rows.map((r) => r.id)).size, 2500, "no duplicates");
    assert.deepEqual(t.cursors, [null, id(1000), id(2000)], "each page continues after the last id");
  });

  it("asks once more when the last page is exactly full", async () => {
    const t = fakeTable(2000, 1000);
    assert.equal((await fetchAllPages(t.fetchPage, "x", 1000)).length, 2000);
    assert.deepEqual(t.cursors, [null, id(1000), id(2000)]);
  });

  it("throws instead of returning partial data when a page fails", async () => {
    let calls = 0;
    const fetchPage = async () =>
      ++calls === 1 ? { data: Array.from({ length: 2 }, (_, i) => ({ id: id(i) })), error: null } : { data: null, error: { code: "500" } };
    await assert.rejects(fetchAllPages(fetchPage, "Failed to load tasks", 2), /Failed to load tasks/);
  });
});

describe("sortTaskRows (same order the database applied)", () => {
  const row = (n: number, o: Partial<{ updated_at: string; due_date: string | null; start_date: string | null; priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT" }>) => ({
    id: id(n),
    updated_at: "2026-10-01T00:00:00Z",
    due_date: null,
    start_date: null,
    priority: "MEDIUM" as const,
    ...o,
  });

  it("defaults to most recently updated first", () => {
    const rows = [row(1, { updated_at: "2026-10-01T00:00:00Z" }), row(2, { updated_at: "2026-10-03T00:00:00Z" }), row(3, { updated_at: "2026-10-02T00:00:00Z" })];
    assert.deepEqual(sortTaskRows(rows).map((r) => r.id), [id(2), id(3), id(1)]);
  });

  it("sorts due dates ascending with empty dates last, then by last update", () => {
    const rows = [
      row(1, { due_date: null }),
      row(2, { due_date: "2026-10-20" }),
      row(3, { due_date: "2026-10-10", updated_at: "2026-10-01T00:00:00Z" }),
      row(4, { due_date: "2026-10-10", updated_at: "2026-10-05T00:00:00Z" }),
    ];
    assert.deepEqual(sortTaskRows(rows, "due").map((r) => r.id), [id(4), id(3), id(2), id(1)]);
  });

  it("sorts start dates ascending with empty dates last", () => {
    const rows = [row(1, { start_date: null }), row(2, { start_date: "2026-10-02" }), row(3, { start_date: "2026-10-01" })];
    assert.deepEqual(sortTaskRows(rows, "start").map((r) => r.id), [id(3), id(2), id(1)]);
  });

  it("sorts priority most urgent first", () => {
    const rows = [row(1, { priority: "LOW" }), row(2, { priority: "URGENT" }), row(3, { priority: "MEDIUM" }), row(4, { priority: "HIGH" })];
    assert.deepEqual(sortTaskRows(rows, "priority").map((r) => r.priority), ["URGENT", "HIGH", "MEDIUM", "LOW"]);
  });

  it("keeps a stable order for identical rows and does not mutate the input", () => {
    const rows = [row(2, {}), row(1, {})];
    assert.deepEqual(sortTaskRows(rows).map((r) => r.id), [id(1), id(2)]);
    assert.deepEqual(rows.map((r) => r.id), [id(2), id(1)]);
  });
});

describe("chunk and uniqueById", () => {
  it("splits ids into bounded chunks", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });

  it("merges overlapping query results without duplicating shared tasks", () => {
    const merged = uniqueById([{ id: "a", n: 1 }, { id: "b", n: 1 }, { id: "a", n: 2 }]);
    assert.deepEqual(merged, [{ id: "a", n: 1 }, { id: "b", n: 1 }]);
  });
});

describe("assigneeFilters (database-side join instead of id lists)", () => {
  it("adds nothing when no assignee filter is set", () => {
    assert.deepEqual(assigneeFilters({}), { embeds: [], conditions: [] });
  });

  it("filters one assignee through its own inner-joined alias", () => {
    const f = assigneeFilters({ assigneeId: "u1" });
    assert.equal(f.embeds.length, 1);
    assert.match(f.embeds[0], /^fa:task_assignees!task_assignees_task_id_fkey!inner\(user_id\)$/);
    assert.deepEqual(f.conditions, [{ column: "fa.user_id", op: "eq", value: "u1" }]);
  });

  it("filters a department's assignees with `in`", () => {
    const f = assigneeFilters({ assigneeIds: ["u1", "u2"] });
    assert.deepEqual(f.conditions, [{ column: "fd.user_id", op: "in", value: ["u1", "u2"] }]);
  });

  it("keeps person and department filters independent (separate aliases, both required)", () => {
    const f = assigneeFilters({ assigneeId: "u1", assigneeIds: ["u2"] });
    assert.deepEqual(f.embeds.map((e) => e.split(":")[0]), ["fa", "fd"]);
    assert.deepEqual(f.conditions.map((c) => c.column), ["fa.user_id", "fd.user_id"]);
  });

  it("never filters the displayed `assignees` embed", () => {
    const f = assigneeFilters({ assigneeId: "u1", assigneeIds: ["u2"] });
    assert.ok(f.conditions.every((c) => !c.column.startsWith("assignees.")));
  });
});
