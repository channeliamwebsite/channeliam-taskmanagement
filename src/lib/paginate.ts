// Reads every row of a paged query (pure, unit-tested).
//
// The Supabase API caps each response (max_rows, 1000 by default) without an
// error, so a single request can silently drop rows. Pages are requested until
// one comes back empty — a short page does not prove the end, because the
// server cap may be smaller than the requested page size.

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  { pageSize = 1000, maxRows = 50_000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await fetchPage(rows.length, rows.length + pageSize - 1);
    if (page.length === 0) return rows;
    rows.push(...page);
    // Fail loudly rather than show a partial list.
    if (rows.length > maxRows) throw new Error(`More than ${maxRows} rows; refusing to load a partial list.`);
  }
}
