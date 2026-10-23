"use client";

import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Error boundary for every signed-in page. Server errors arrive here as a
 * generic message plus a digest (Next.js strips the details); the matching
 * server log line carries the database error code and message.
 */
export default function ProtectedError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>
      <h2 className="text-base font-semibold">This page couldn&apos;t load</h2>
      <p className="text-sm text-muted-foreground">
        Something went wrong while loading your data. Please try again. If it keeps happening, report it with the reference below.
      </p>
      {error.digest ? <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
      <Button onClick={() => retry()} className="mt-1">
        <RotateCw aria-hidden="true" /> Try again
      </Button>
    </div>
  );
}
