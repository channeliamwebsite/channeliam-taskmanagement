"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useDeletionImpact } from "@/components/app/deletion-impact";
import { Button } from "@/components/ui/button";
import { deleteClient, getClientDeletionImpact } from "@/lib/actions/clients";

/**
 * Super admin. Policy: a client is deleted only once it has no projects; its
 * projects are listed and must be moved to another client or deleted first.
 */
export function DeleteClientButton({ clientId, name }: { clientId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const impact = useDeletionImpact(open, () => getClientDeletionImpact(clientId));
  const projects = impact.status === "ready" ? impact.data.projects : [];

  return (
    <>
      <Button variant="destructive" className="h-9" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" /> Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete “${name}”?`}
        description="The client and its contact details will be permanently deleted. Projects are never deleted or detached with a client."
        pending={pending}
        confirmDisabled={impact.status !== "ready" || projects.length > 0}
        onConfirm={() =>
          startTransition(async () => {
            const r = await deleteClient(clientId);
            if (r.ok) {
              toast.success("Client deleted");
              setOpen(false);
              router.replace("/clients");
            } else toast.error(r.error);
          })
        }
      >
        {impact.status === "ready" ? (
          projects.length ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-medium">
                This client still has {projects.length} project{projects.length === 1 ? "" : "s"}. Move each one to another client (Edit
                project) or delete it, then try again:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {projects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="underline underline-offset-2" onClick={() => setOpen(false)}>
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-muted-foreground">No projects belong to this client.</p>
          )
        ) : impact.status === "error" ? (
          <p className="text-destructive">{impact.error}</p>
        ) : (
          <p className="text-muted-foreground">Checking the client&apos;s projects…</p>
        )}
      </ConfirmDialog>
    </>
  );
}
