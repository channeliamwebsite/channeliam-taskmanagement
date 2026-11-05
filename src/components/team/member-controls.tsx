"use client";

import { Check, Copy, Loader2, MoreHorizontal, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { createEmployee, reissueInvite, sendPasswordReset, setEmployeeActive, setWorkspaceAccess } from "@/lib/actions/employees";
import { removeMember, setCanCreateClientsProjects, setCanCreateProjects, updateMemberProfile } from "@/lib/actions/workspace";
import { ROLE_LABELS, type UserRole } from "@/lib/auth/roles";
import type { AddEmployeeResult } from "@/lib/employee-workflow";

const ROLES: UserRole[] = ["SUPER_ADMIN", "ADMIN", "INDIVIDUAL"];

export type ManagerOption = { userId: string; name: string };
export type WorkspaceOption = { id: string; name: string };

/** Department input: existing departments are suggested, a new one can be typed. */
function DepartmentInput({ id, value, onChange, departments }: { id: string; value: string; onChange: (v: string) => void; departments: string[] }) {
  return (
    <>
      <Input id={id} list={`${id}-options`} value={value} onChange={(e) => onChange(e.target.value)} maxLength={100} placeholder="e.g. News Desk" className="h-9" />
      <datalist id={`${id}-options`}>
        {departments.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
    </>
  );
}

function CopyLink({ link, kind = "invite" }: { link: string; kind?: "invite" | "reset" }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="invite-link">{kind === "reset" ? "One-time password reset link" : "One-time invite link"}</Label>
      <div className="flex gap-2">
        <Input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-9 font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0"
          onClick={() => {
            navigator.clipboard.writeText(link).then(
              () => setCopied(true),
              () => toast.error("Copy failed — select the link and copy it manually."),
            );
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Share it only with this employee. It signs them in once so they can choose a password{kind === "reset" ? ", and expires in one hour" : ""}.
      </p>
    </div>
  );
}

/** Invitation, password reset and activation actions shared by /team and /hr/employees/[id]. */
function useAccountActions(workspaceId: string | null, member: { userId: string; name: string; email: string | null; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<{ url: string; kind: "invite" | "reset" } | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);

  function reissue(delivery: "email" | "link") {
    if (!workspaceId) return;
    startTransition(async () => {
      const r = await reissueInvite(workspaceId, member.userId, delivery);
      if (!r.ok) toast.error(r.error);
      else if (r.data.link) setLink({ url: r.data.link, kind: "invite" });
      else toast.success(`Invitation email sent to ${member.email ?? member.name}`);
    });
  }

  function resetPassword(delivery: "email" | "link") {
    if (!workspaceId) return;
    startTransition(async () => {
      const r = await sendPasswordReset(workspaceId, member.userId, delivery);
      if (!r.ok) toast.error(r.error);
      else if (r.data.link) setLink({ url: r.data.link, kind: "reset" });
      else toast.success(`Password reset email sent to ${member.email ?? member.name}`);
    });
  }

  const dialogs = (
    <>
      <Dialog open={link !== null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{link?.kind === "reset" ? `Password reset link for ${member.name}` : `Invite link for ${member.name}`}</DialogTitle>
            <DialogDescription>No email was sent.</DialogDescription>
          </DialogHeader>
          {link ? <CopyLink link={link.url} kind={link.kind} /> : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        title={member.isActive ? `Deactivate ${member.name}?` : `Reactivate ${member.name}?`}
        description={
          member.isActive
            ? "They will be signed out and cannot sign in or access any workspace. Their tasks, reports and workspace memberships are kept."
            : "They can sign in again and regain access to the workspaces they are still a member of."
        }
        confirmLabel={member.isActive ? "Deactivate" : "Reactivate"}
        pending={pending}
        onConfirm={() =>
          startTransition(async () => {
            const r = await setEmployeeActive(member.userId, !member.isActive);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            if (r.data.warning) toast.warning(r.data.warning);
            else toast.success(member.isActive ? "Employee deactivated" : "Employee reactivated");
            setStatusOpen(false);
          })
        }
      />
    </>
  );

  return { pending, startTransition, reissue, resetPassword, openStatus: () => setStatusOpen(true), dialogs };
}

export type EmployeeMember = {
  userId: string;
  name: string;
  fullName: string | null;
  email: string | null;
  role: UserRole;
  isActive: boolean;
  jobTitle: string | null;
  managerId: string | null;
  team: string | null;
  pendingInvite: boolean;
};

/**
 * Employment details (name, department, designation, role, reporting manager),
 * saved with updateMemberProfile: super admins only, and RLS plus the profile
 * guard trigger check every change. Formerly the /team edit dialog.
 */
export function EmploymentForm({
  member,
  isSelf,
  managers,
  departments,
}: {
  member: EmployeeMember;
  isSelf: boolean;
  managers: ManagerOption[];
  departments: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [fullName, setFullName] = useState(member.fullName ?? "");
  const [role, setRole] = useState<UserRole>(member.role);
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? "");
  const [team, setTeam] = useState(member.team ?? "");
  const [managerId, setManagerId] = useState(member.managerId ?? "");

  function save(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const r = await updateMemberProfile(member.userId, {
        fullName,
        ...(isSelf || role === member.role ? {} : { role }),
        jobTitle,
        team,
        managerId: managerId || null,
      });
      if (r.ok) toast.success("Employment details saved");
      else toast.error(r.error);
    });
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="member-name">Full name</Label>
        <Input id="member-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} className="h-9" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="member-team">Department</Label>
          <DepartmentInput id="member-team" value={team} onChange={setTeam} departments={departments} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="member-title">Designation</Label>
          <Input id="member-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={200} className="h-9" />
        </div>
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
          <Label htmlFor="member-manager">Reporting manager</Label>
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
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Role changes apply on the employee&apos;s next page load.</p>
      <div>
        <Button type="submit" disabled={pending || !fullName.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save employment details
        </Button>
      </div>
    </form>
  );
}

/**
 * Account: invitation or password reset, activation and workspace access
 * (super admins). `workspaceId` is a workspace the employee belongs to (the
 * invite and reset actions check membership); null hides those two actions.
 */
export function AccountPanel({
  workspaceId,
  member,
  isSelf,
  workspaces,
}: {
  workspaceId: string | null;
  member: EmployeeMember;
  isSelf: boolean;
  workspaces: (WorkspaceOption & { member: boolean })[];
}) {
  const actions = useAccountActions(workspaceId, member);
  const [access, setAccess] = useState<Record<string, boolean>>(() => Object.fromEntries(workspaces.map((w) => [w.id, w.member])));
  const changed = workspaces.some((w) => access[w.id] !== w.member);

  function saveAccess() {
    actions.startTransition(async () => {
      // Apply only what changed, one membership at a time.
      const failed: string[] = [];
      for (const w of workspaces) {
        if (access[w.id] === w.member) continue;
        const a = await setWorkspaceAccess(w.id, member.userId, access[w.id]!);
        if (!a.ok) failed.push(`${w.name}: ${a.error}`);
      }
      if (failed.length) toast.error(`Workspace access was not fully updated — ${failed.join("; ")}`);
      else toast.success("Workspace access updated");
    });
  }

  return (
    <div className="grid gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={member.isActive ? "text-emerald-700" : "text-destructive"}>
          {member.isActive ? (member.pendingInvite ? "Active · invitation not accepted yet" : "Active") : "Deactivated"}
        </span>
        {!isSelf ? (
          <Button size="sm" variant={member.isActive ? "outline" : "default"} disabled={actions.pending} onClick={actions.openStatus}>
            {member.isActive ? "Deactivate" : "Reactivate"}
          </Button>
        ) : null}
      </div>
      {member.isActive && workspaceId ? (
        <div className="flex flex-wrap gap-2">
          {member.pendingInvite ? (
            <>
              <Button size="sm" variant="outline" disabled={actions.pending} onClick={() => actions.reissue("email")}>
                Resend invitation email
              </Button>
              <Button size="sm" variant="ghost" disabled={actions.pending} onClick={() => actions.reissue("link")}>
                Get invite link
              </Button>
            </>
          ) : !isSelf ? (
            <>
              <Button size="sm" variant="outline" disabled={actions.pending} onClick={() => actions.resetPassword("email")}>
                Send password reset email
              </Button>
              <Button size="sm" variant="ghost" disabled={actions.pending} onClick={() => actions.resetPassword("link")}>
                Get password reset link
              </Button>
            </>
          ) : null}
        </div>
      ) : member.isActive ? (
        <p className="text-xs text-muted-foreground">Add the employee to a workspace to send an invitation or a password reset.</p>
      ) : null}
      {workspaces.length ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 font-medium">Workspace access</legend>
          {workspaces.map((w) => (
            <label key={w.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={access[w.id] ?? w.member}
                disabled={isSelf || actions.pending}
                onChange={(e) => setAccess((prev) => ({ ...prev, [w.id]: e.target.checked }))}
              />
              {w.name}
            </label>
          ))}
          <p className="text-xs text-muted-foreground">Removing access keeps the employee&apos;s past tasks and reports.</p>
          {changed ? (
            <div>
              <Button size="sm" disabled={actions.pending} onClick={saveAccess}>
                Save workspace access
              </Button>
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {actions.dialogs}
    </div>
  );
}

export function MemberActions({
  workspaceId,
  member,
  isSelf,
}: {
  workspaceId: string;
  member: {
    userId: string;
    name: string;
    fullName: string | null;
    email: string | null;
    role: UserRole;
    isActive: boolean;
    canCreateProjects: boolean;
    canCreateClientsProjects: boolean;
    jobTitle: string | null;
    managerId: string | null;
    team: string | null;
    pendingInvite: boolean;
  };
  isSelf: boolean;
}) {
  const router = useRouter();
  const actions = useAccountActions(workspaceId, member);
  const { pending, startTransition } = actions;
  const [removeOpen, setRemoveOpen] = useState(false);

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
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{member.name}</DropdownMenuLabel>
            {/* Editing happens on the single employee page. */}
            <DropdownMenuItem onClick={() => router.push(`/hr/employees/${member.userId}`)}>Edit employee & access</DropdownMenuItem>
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
            {member.role === "INDIVIDUAL" ? (
              <DropdownMenuItem
                onClick={() =>
                  run(
                    () => setCanCreateClientsProjects(workspaceId, member.userId, !member.canCreateClientsProjects),
                    member.canCreateClientsProjects ? "Client and project creation disabled" : "Client and project creation enabled",
                  )
                }
              >
                {member.canCreateClientsProjects ? "Disallow creating clients and projects" : "Allow creating clients and projects"}
              </DropdownMenuItem>
            ) : null}
            {member.pendingInvite && member.isActive ? (
              <>
                <DropdownMenuItem onClick={() => actions.reissue("email")}>Resend invitation email</DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.reissue("link")}>Get invite link</DropdownMenuItem>
              </>
            ) : null}
            {!member.pendingInvite && member.isActive && !isSelf ? (
              <>
                <DropdownMenuItem onClick={() => actions.resetPassword("email")}>Send password reset email</DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.resetPassword("link")}>Get password reset link</DropdownMenuItem>
              </>
            ) : null}
            {!isSelf ? (
              <>
                <DropdownMenuItem onClick={actions.openStatus}>
                  {member.isActive ? "Deactivate employee" : "Reactivate employee"}
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

      {actions.dialogs}

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

const EMPTY = { fullName: "", email: "", team: "", jobTitle: "", role: "INDIVIDUAL" as UserRole, managerId: "" };

export function AddEmployeeButton({ workspaceId, managers, departments }: { workspaceId: string; managers: ManagerOption[]; departments: string[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [sendEmail, setSendEmail] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AddEmployeeResult | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof typeof EMPTY) => (value: string) => setForm((f) => ({ ...f, [k]: value }));

  function reset() {
    setForm(EMPTY);
    setError(null);
    setOutcome(null);
    setSendEmail(true);
  }

  function submit(options: { delivery: "email" | "link"; addExisting?: boolean }) {
    setError(null);
    startTransition(async () => {
      const r = await createEmployee({ workspaceId, ...form, ...options });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const result = r.data;
      setOutcome(result);
      if (result.status === "created" && result.delivery === "email") {
        toast.success(`Invitation sent to ${form.email.trim()}`);
        setOpen(false);
        reset();
      } else if (result.status === "added_existing") {
        // The form's name/role were not applied to the existing account.
        toast.success(`${form.email.trim()} added to the workspace. Their role and details were not changed.`);
        setOpen(false);
        reset();
      }
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit({ delivery: sendEmail ? "email" : "link" });
  }

  const finished = outcome && (outcome.status === "created" || outcome.status === "partial");

  return (
    <>
      <Button className="h-9" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" /> Add employee
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add employee</DialogTitle>
            <DialogDescription>Creates the account, adds it to this workspace and invites the employee to set a password.</DialogDescription>
          </DialogHeader>

          {outcome?.status === "created" && outcome.delivery === "link" ? (
            <div className="grid gap-3">
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Account created and added to the workspace. No email was sent.</p>
              <CopyLink link={outcome.link} />
            </div>
          ) : null}

          {outcome?.status === "partial" ? (
            <div className="grid gap-3">
              <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">Set-up is not complete.</p>
                {outcome.done.length ? <p>Done: {outcome.done.join("; ")}.</p> : null}
                <p>Not done: {outcome.failed}</p>
                <p className="mt-1 text-xs">Fix it from the Employees list (Edit employee &amp; access), or add the employee again to retry.</p>
              </div>
              {outcome.link ? <CopyLink link={outcome.link} /> : null}
            </div>
          ) : null}

          {finished ? (
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </DialogFooter>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              {error ? (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {outcome?.status === "duplicate" ? (
                <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  An employee with this email is already in this workspace.
                </p>
              ) : null}
              {outcome?.status === "exists" ? (
                <div role="alert" className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p>
                    An account with this email already exists but is not in this workspace. Adding it only gives access to this
                    workspace: their role, name, department, designation and manager stay as they are (change them later with Edit
                    employee). No new account is created.
                    {outcome.pendingInvite ? " Their invitation has not been accepted yet, so a new one will be issued." : ""}
                  </p>
                  <Button type="button" size="sm" className="justify-self-start" disabled={pending} onClick={() => submit({ delivery: sendEmail ? "email" : "link", addExisting: true })}>
                    Add existing account to this workspace
                  </Button>
                </div>
              ) : null}
              {outcome?.status === "invite_failed" ? (
                <div role="alert" className="grid gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <p>The invitation could not be sent: {outcome.error}</p>
                  <p className="text-xs">The employee was not added. You can create the account with a one-time invite link to share yourself.</p>
                  <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={pending} onClick={() => submit({ delivery: "link", addExisting: true })}>
                    Create with an invite link instead
                  </Button>
                </div>
              ) : null}

              <div className="grid gap-1.5">
                <Label htmlFor="add-name">Full name *</Label>
                <Input id="add-name" value={form.fullName} onChange={(e) => set("fullName")(e.target.value)} maxLength={200} autoFocus className="h-9" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="add-email">Work email *</Label>
                <Input id="add-email" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} maxLength={254} className="h-9" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="add-team">Department</Label>
                  <DepartmentInput id="add-team" value={form.team} onChange={set("team")} departments={departments} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="add-title">Designation</Label>
                  <Input id="add-title" value={form.jobTitle} onChange={(e) => set("jobTitle")(e.target.value)} maxLength={200} className="h-9" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="add-role">Role</Label>
                  <NativeSelect id="add-role" value={form.role} onChange={(e) => set("role")(e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="add-manager">Reporting manager</Label>
                  <NativeSelect id="add-manager" value={form.managerId} onChange={(e) => set("managerId")(e.target.value)}>
                    <option value="">None</option>
                    {managers.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
                <span>
                  Send the invitation by email
                  <span className="block text-xs text-muted-foreground">Untick to get a one-time invite link to share yourself instead.</span>
                </span>
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending || !form.email.trim() || !form.fullName.trim()}>
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  {sendEmail ? "Create & invite" : "Create & get link"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
