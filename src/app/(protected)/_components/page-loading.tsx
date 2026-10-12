/**
 * Fallback for a page segment while its request-time data (session, Supabase
 * queries) streams in. Each page segment has its own loading.tsx using this,
 * so client navigations between sibling pages under the shared (protected)
 * layout have a Suspense boundary inside the re-rendered part of the tree
 * (required for instant navigation with Cache Components + Partial Prefetching).
 */
export function PageLoading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted/70" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-muted/40" />
    </div>
  );
}
