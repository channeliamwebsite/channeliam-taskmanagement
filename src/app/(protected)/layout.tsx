import { Suspense, type ReactNode } from "react";

import { AppShell, ShellSkeleton } from "./_components/app-shell";

// The shell reads the session at request time, so it renders inside Suspense
// (required with Cache Components). Each page still performs its own
// server-side authorization; the layout is not the security boundary.
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
