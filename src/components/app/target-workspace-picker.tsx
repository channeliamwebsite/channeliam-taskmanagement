"use client";

import { Building2, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { NativeSelect } from "@/components/ui/native-select";
import { switchWorkspace } from "@/lib/actions/workspace";

/**
 * Super admins: the workspace that new tasks, clients and projects on this page
 * are created in. Super admins are not members of workspaces (025), so the
 * target is chosen explicitly here; the server checks it again and the
 * database keeps every record in its project's workspace.
 */
export function TargetWorkspacePicker({ workspaces, activeId }: { workspaces: { id: string; name: string }[]; activeId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Building2 className="size-3.5" aria-hidden="true" />}
      Create in
      <NativeSelect
        aria-label="Workspace for new records"
        className="h-8 min-w-36"
        value={activeId}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          startTransition(async () => {
            const r = await switchWorkspace(id);
            if (!r.ok) toast.error(r.error);
          });
        }}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
