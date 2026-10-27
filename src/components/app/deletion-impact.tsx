"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ActionResult } from "@/lib/actions/shared";

export type ImpactState<T> = { status: "idle" | "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };

/** Loads what a delete would also remove, each time the dialog opens. */
export function useDeletionImpact<T>(open: boolean, load: () => Promise<ActionResult<T>>): ImpactState<T> {
  // Each opening is a new check, so an earlier result is never shown as current.
  const [opening, setOpening] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOpening((n) => n + 1);
  }
  const [result, setResult] = useState<{ opening: number; state: ImpactState<T> } | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadRef
      .current()
      .then((r) => {
        if (!cancelled) setResult({ opening, state: r.ok ? { status: "ready", data: r.data } : { status: "error", error: r.error } });
      })
      .catch(() => {
        if (!cancelled) setResult({ opening, state: { status: "error", error: "Could not check what will be deleted." } });
      });
    return () => {
      cancelled = true;
    };
  }, [open, opening]);

  if (!open) return { status: "idle" };
  return result?.opening === opening ? result.state : { status: "loading" };
}

/** "Also deleted:" list, a loading line, or the error. */
export function ImpactSummary({ state, lines, empty }: { state: ImpactState<unknown>; lines: string[]; empty: string }) {
  if (state.status === "idle" || state.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Checking what will be deleted…
      </p>
    );
  }
  if (state.status === "error") return <p className="text-destructive">{state.error}</p>;
  if (!lines.length) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
      <p className="font-medium">Also permanently deleted:</p>
      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
