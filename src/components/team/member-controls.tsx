"use client";

import { Loader2, MoreHorizontal, UserPlus } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  addMemberByEmail,
  removeMember,
  setCanCreateProjects,
  updateMemberProfile,
} from "@/lib/actions/workspace";
import { ROLE_LABELS, type UserRole } from "@/lib/auth/roles";

const ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "INDIVIDUAL"];

export function MemberActions({
  workspaceId,
  member,
  isSelf,
  managers,
}: {
  workspaceId: string;
  managers: { userId: string; name: string }[];
  member: {
    userId: string;
    name: string;
    role: UserRole;
    isActive: boolean;
    canCreateProjects: boolean;
    department: string | null;
    jobTitle: string | null;
    managerId: string | null;
    team: string | null;
  };
  isSelf: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [role, setRole] = useState<UserRole>(member.role);
  const [department, setDepartment] = useState(member.department ?? "");
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? "");
  const [team, setTeam] = useState(member.team ?? "");
  const [managerId, setManagerId] = useState(member.managerId ?? "");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        after?.();
      } else toast.error(r.error ?? "Something went wrong.");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex size-8 items-center justify-center rounded-lg outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          aria-label={`Manage ${member.name}`}
          disabled={pending}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{member.name}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                setRole(member.role);
                setDepartment(member.department ?? "");
                setJobTitle(member.jobTitle ?? "");
                setTeam(member.team ?? "");
                setManagerId(member.managerId ?? "");
                setEditOpen(true);
              }}
            >
              Edit role, team & manager
            </DropdownMenuItem>
            {member.role === "ADMIN" ? (
              <DropdownMenuItem
                onClick={() =>
                  run(
                    () => setCanCreateProjects(workspaceId, member.userId, !member.canCreateProjects),
                    member.canCreateProjects ? "Project creation disabled" : "Project creation enabled",
                  )
                }
              >
                {member.canCreateProjects ? "Disallow creating projects" : "Allow creating projects"}
              </DropdownMenuItem>
            ) : null}
            {!isSelf ? (
              <>
                <DropdownMenuItem
                  onClick={() =>
                    run(
                      () => updateMemberProfile(member.userId, { isActive: !member.isActive }),
                      member.isActive ? "User deactivated" : "User reactivated",
                    )
                  }
                >
                  {member.isActive ? "Deactivate account" : "Reactivate account"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setRemoveOpen(true)}>
                  Remove from workspace
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {member.name}</DialogTitle>
            <DialogDescription>Role changes apply on the user&apos;s next page load.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="member-role">Role</Label>
              <NativeSelect id="member-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={isSelf}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
              {isSelf ? <p className="text-xs text-muted-foreground">You can&apos;t change your own role.</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="member-department">Department</Label>
              <Input id="member-department" value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={200} className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="member-team">Team</Label>
              <Input id="member-team" value={team} onChange={(e) => setTeam(e.target.value)} maxLength={100} placeholder="e.g. Production, Desk, Website & SEO" className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="member-manager">Reports to</Label>
              <NativeSelect id="member-manager" value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                <option value="">No reporting manager</option>
                {managers
                  .filter((m) => m.userId !== member.userId)
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">Independent of task assignment.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="member-title">Job title</Label>
              <Input id="member-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={200} className="h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    updateMemberProfile(member.userId, {
                      ...(isSelf || role === member.role ? {} : { role }),
                      department,
                      jobTitle,
                      team,
                      managerId: managerId || null,
                    }),
                  "Member updated",
                  () => setEditOpen(false),
                )
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${member.name}?`}
        description="They will lose access to this workspace's projects and tasks. Their account and past work are kept."
        confirmLabel="Remove"
        pending={pending}
        onConfirm={() => run(() => removeMember(workspaceId, member.userId), "Member removed", () => setRemoveOpen(false))}
      />
    </>
  );
}

export function AddMemberButton({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("INDIVIDUAL");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await addMemberByEmail(workspaceId, email, role);
      if (r.ok) {
        toast.success("Member added");
        setOpen(false);
        setEmail("");
      } else setError(r.error);
    });
  }

  return (
    <>
      <Button className="h-9" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" /> Add member
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a member</DialogTitle>
            <DialogDescription>
              The person must already have an account (create it in Supabase → Authentication → Users).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="add-email">Email</Label>
              <Input id="add-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus className="h-9" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="add-role">Role</Label>
              <NativeSelect id="add-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !email.trim()}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Add member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
