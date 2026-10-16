"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { NativeSelect } from "@/components/ui/native-select";
import { updateBugStatus } from "@/lib/actions/bugs";
import { BUG_STATUSES, BUG_STATUS_LABELS, type BugStatus } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function BugStatusSelect({ id, status }: { id: string; status: BugStatus }) {
  const [pending, startTransition] = useTransition();
  return (
    <NativeSelect
      aria-label="Bug status"
      value={status}
      disabled={pending}
      className={cn("w-36", pending && "opacity-70")}
      onChange={(e) => {
        const next = e.target.value as BugStatus;
        startTransition(async () => {
          const r = await updateBugStatus(id, next);
          if (r.ok) toast.success(`Marked ${BUG_STATUS_LABELS[next].toLowerCase()}`);
          else toast.error(r.error);
        });
      }}
    >
      {BUG_STATUSES.map((s) => (
        <option key={s} value={s}>
          {BUG_STATUS_LABELS[s]}
        </option>
      ))}
    </NativeSelect>
  );
}
