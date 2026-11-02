import "server-only";

import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/domain";
import { loadError } from "./errors";

export type Collaborator = { userId: string; name: string; email: string | null; grantedAt: string };

/**
 * People from other workspaces with access to one project (030). RLS: super
 * admins, admins of the project's workspace and the person themselves.
 */
export async function listProjectCollaborators(projectId: string): Promise<Collaborator[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_collaborators")
    .select("user_id, granted_at, profile:profiles!project_collaborators_user_id_fkey(full_name, email)")
    .eq("project_id", projectId)
    .order("granted_at");
  if (error) throw loadError("Failed to load project access", error);
  return data.map((c) => ({
    userId: c.user_id,
    name: displayName({ full_name: c.profile?.full_name ?? null, email: c.profile?.email ?? null }),
    email: c.profile?.email ?? null,
    grantedAt: c.granted_at,
  }));
}

/** Active employees company-wide (super admins only, RLS 025), for granting access. */
export async function listActiveEmployees(): Promise<{ userId: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name");
  if (error) throw loadError("Failed to load employees", error);
  return data.map((p) => ({ userId: p.id, name: displayName({ full_name: p.full_name, email: p.email }) }));
}

/** Projects the caller collaborates on (030), with each project's workspace id. */
export async function listMyCollaborationProjectIds(userId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("project_collaborators").select("project_id").eq("user_id", userId);
  if (error) throw loadError("Failed to load project access", error);
  return data.map((r) => r.project_id);
}
