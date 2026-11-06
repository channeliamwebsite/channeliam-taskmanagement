"use client";

import { Check, ChevronDown, Layers } from "lucide-react";
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
    return <p className="px-3 text-xs text-muted-foreground">No workspace</p>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm shadow-xs outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        disabled={pending}
        aria-label="Switch workspace"
      >
        <Layers className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{active?.name ?? "Select workspace"}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
