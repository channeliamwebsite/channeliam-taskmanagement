"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { updateWorkspaceTimezone } from "@/lib/actions/workspace";

const COMMON = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

export function TimezoneForm({ workspaceId, timezone }: { workspaceId: string; timezone: string }) {
  const [value, setValue] = useState(timezone);
  const [pending, startTransition] = useTransition();
  const options = COMMON.includes(timezone) ? COMMON : [timezone, ...COMMON];

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const r = await updateWorkspaceTimezone(workspaceId, value);
      if (r.ok) toast.success("Workspace timezone updated");
      else toast.error(r.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor="workspace-tz">Timezone</Label>
        <NativeSelect id="workspace-tz" value={value} onChange={(e) => setValue(e.target.value)}>
          {options.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" className="h-9" disabled={pending || value === timezone}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        Save
      </Button>
    </form>
  );
}
