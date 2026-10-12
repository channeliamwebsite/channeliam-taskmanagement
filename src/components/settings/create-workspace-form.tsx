"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspace } from "@/lib/actions/workspace";

export function CreateWorkspaceForm() {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Workspace name is required.");
      return;
    }
    startTransition(async () => {
      const result = await createWorkspace(name);
      if (result.ok) {
        toast.success("Workspace created");
        setName("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-2 text-left sm:flex-row sm:items-end">
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor="workspace-name">Workspace name</Label>
        <Input
          id="workspace-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Main workspace"
          maxLength={200}
          disabled={pending}
          className="h-9"
        />
      </div>
      <Button type="submit" disabled={pending} className="h-9">
        {pending ? <Loader2 className="animate-spin" /> : null}
        Create
      </Button>
    </form>
  );
}
