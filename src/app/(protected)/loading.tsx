// Suspense boundary for protected pages: they read the session at request
// time, which Cache Components requires to happen inside Suspense.
export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center p-10" aria-busy="true">
      <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
