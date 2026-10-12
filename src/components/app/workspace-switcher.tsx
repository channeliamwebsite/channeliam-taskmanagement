"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchWorkspace } from "@/lib/actions/workspace";

export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: { id: string; name: string }[];
  activeId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const active = workspaces.find((w) => w.id === activeId);

  if (workspaces.length === 0) {
    return <p className="px-2 text-xs text-muted-foreground">No workspace</p>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-left text-sm shadow-xs outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        disabled={pending}
        aria-label="Switch workspace"
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{active?.name ?? "Select workspace"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onClick={() => {
                if (w.id === activeId) return;
                startTransition(async () => {
                  const result = await switchWorkspace(w.id);
                  if (!result.ok) toast.error(result.error);
                });
              }}
            >
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === activeId ? <Check className="size-4" aria-hidden="true" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
