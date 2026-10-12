import { PageLoading } from "./_components/page-loading";

// Group-level fallback (page loads). Each page segment also has its own
// loading.tsx so sibling client navigations stay instant.
export default function Loading() {
  return <PageLoading />;
}
