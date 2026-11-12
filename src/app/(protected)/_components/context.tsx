import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/app/page-header";
import { CreateWorkspaceForm } from "@/components/settings/create-workspace-form";
import { requireRole, requireSession, type Session } from "@/lib/auth/dal";
import type { UserRole } from "@/lib/auth/roles";
import { getActiveWorkspace, type Workspace } from "@/lib/data/workspace";

/**
 * Session + active workspace for a page. The two are independent — workspace
 * selection reads its own auth cookie and RLS-scoped query, it never depends
 * on the resolved session — so they run concurrently. If the session check
 * redirects (signed out, inactive, wrong role), that redirect still propagates
 * normally out of Promise.all.
 */
export async function getPageContext(roles?: readonly UserRole[]): Promise<{
  session: Session;
  workspace: Workspace | null;
}> {
  const [session, workspace] = await Promise.all([roles ? requireRole(roles) : requireSession(), getActiveWorkspace()]);
  return { session, workspace };
}

export function NoWorkspace({ session }: { session: Session }) {
  if (session.profile.role === "SUPER_ADMIN") {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          icon={Building2}
          title="Create your first workspace"
          description="A workspace holds your agency's projects, tasks and team members."
          action={<CreateWorkspaceForm />}
        />
      </div>
    );
  }
  return (
    <EmptyState
      icon={Building2}
      title="You're not in a workspace yet"
      description="Ask a super admin to add you to your agency's workspace."
    />
  );
}
