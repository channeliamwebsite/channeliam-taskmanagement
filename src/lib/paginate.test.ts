import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchAllPages } from "./paginate.ts";

/** A fake API over `total` rows that returns at most `cap` rows per request. */
function api(total: number, cap: number) {
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + cap, total);
    return Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i);
  };
  return { calls, fetchPage };
}

describe("fetchAllPages", () => {
  it("reads past the 1,000-row response cap", async () => {
    const { fetchPage } = api(2500, 1000);
    const rows = await fetchAllPages(fetchPage);
    assert.equal(rows.length, 2500);
    assert.deepEqual(rows.slice(998, 1002), [998, 999, 1000, 1001], "no gap or overlap at page boundaries");
  });

  it("does not stop early when the server cap is below the page size", async () => {
    const { fetchPage } = api(1200, 500);
    assert.equal((await fetchAllPages(fetchPage, { pageSize: 1000 })).length, 1200);
  });

  it("handles an empty result with a single request", async () => {
    const { fetchPage, calls } = api(0, 1000);
    assert.deepEqual(await fetchAllPages(fetchPage), []);
    assert.equal(calls.length, 1);
  });

  it("throws instead of returning a partial list past the limit", async () => {
    const { fetchPage } = api(5000, 1000);
    await assert.rejects(fetchAllPages(fetchPage, { maxRows: 3000 }), /refusing to load a partial list/);
  });
});
