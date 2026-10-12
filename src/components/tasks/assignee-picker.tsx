"use client";

import { Star } from "lucide-react";

import { UserAvatar } from "@/components/app/user-avatar";
import { ROLE_LABELS, type UserRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

export type MemberOption = { userId: string; name: string; role: UserRole; isActive: boolean };

/** Multi-select of workspace members with a single primary assignee. */
export function AssigneePicker({
  members,
  selected,
  primaryId,
  onChange,
  disabled,
}: {
  members: MemberOption[];
  selected: string[];
  primaryId: string | null;
  onChange: (selected: string[], primaryId: string | null) => void;
  disabled?: boolean;
}) {
  const active = members.filter((m) => m.isActive);

  function toggle(userId: string) {
    const next = selected.includes(userId) ? selected.filter((id) => id !== userId) : [...selected, userId];
    const nextPrimary = next.includes(primaryId ?? "") ? primaryId : (next[0] ?? null);
    onChange(next, nextPrimary);
  }

  if (active.length === 0) {
    return <p className="text-sm text-muted-foreground">No active members in this workspace.</p>;
  }

  return (
    <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border" aria-label="Assignees">
      {active.map((m) => {
        const checked = selected.includes(m.userId);
        const isPrimary = checked && primaryId === m.userId;
        return (
          <li key={m.userId} className="flex items-center gap-2 px-2.5 py-1.5">
            <input
              id={`assignee-${m.userId}`}
              type="checkbox"
              className="size-4 accent-primary"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(m.userId)}
            />
            <label htmlFor={`assignee-${m.userId}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
              <UserAvatar name={m.name} seed={m.userId} size="sm" />
              <span className="truncate text-sm">{m.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
            </label>
            {checked ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(selected, m.userId)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs",
                  isPrimary ? "bg-amber-50 text-amber-700" : "text-muted-foreground hover:bg-muted",
                )}
                aria-pressed={isPrimary}
                aria-label={isPrimary ? `${m.name} is primary` : `Make ${m.name} primary`}
              >
                <Star className={cn("size-3.5", isPrimary && "fill-current")} aria-hidden="true" />
                {isPrimary ? "Primary" : "Make primary"}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
