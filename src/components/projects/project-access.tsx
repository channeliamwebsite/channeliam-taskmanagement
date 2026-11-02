"use client";

import { Loader2, UserPlus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { grantProjectAccess, revokeProjectAccess } from "@/lib/actions/projects";

/**
 * People from other workspaces who may be assigned this project's tasks (030).
 * Super admins grant and remove access; others see the list read-only.
 */
export function ProjectAccess({
  projectId,
  collaborators,
  candidates,
  canManage,
}: {
  projectId: string;
  collaborators: { userId: string; name: string }[];
  /** Active employees who are not members of the project's workspace (super admins only). */
  candidates: { userId: string; name: string }[];
  canManage: boolean;
}) {
  const [pick, setPick] = useState("");
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(success);
        setPick("");
      } else toast.error(r.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="grid gap-3">
      {collaborators.length ? (
        <ul className="divide-y rounded-lg border">
          {collaborators.map((c) => (
            <li key={c.userId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {canManage ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => revokeProjectAccess(projectId, c.userId), "Access removed")}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                  aria-label={`Remove ${c.name}'s access`}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody from another workspace has access.</p>
      )}
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted-foreground">
            Give access to someone from another workspace
            <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} disabled={pending}>
              <option value="">Choose a person…</option>
              {candidates.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button
            variant="outline"
            className="h-9"
            disabled={!pick || pending}
            onClick={() => run(() => grantProjectAccess(projectId, pick), "Access given")}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
            Give access
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        They see only this project and the tasks assigned to them, not the rest of the workspace. Access cannot be removed
        while they have open assignments here.
      </p>
    </div>
  );
}
