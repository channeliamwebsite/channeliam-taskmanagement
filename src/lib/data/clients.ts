import "server-only";

import { createClient } from "@/lib/supabase/server";
import { loadError } from "./errors";

export type Client = {
  id: string;
  name: string;
  /** Only populated for admins (contact columns are not readable by members). */
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  isActive: boolean;
};

/**
 * Client contact details for a workspace. The database returns rows only to
 * admins/super admins of that workspace (get_client_contacts), so this is an
 * empty map for everyone else.
 */
async function contactsFor(workspaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_client_contacts", { p_workspace_id: workspaceId });
  if (error) throw loadError("Failed to load client contacts", error);
  return new Map(data.map((c) => [c.id, { contactName: c.contact_name, contactEmail: c.contact_email }]));
}

export async function getClient(
  clientId: string,
  opts: { withContacts?: boolean } = {},
): Promise<(Client & { workspaceId: string }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, notes, is_active, workspace_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw loadError("Failed to load client", error);
  if (!data) return null;
  const contact = opts.withContacts ? (await contactsFor(data.workspace_id)).get(data.id) : undefined;
  return {
    id: data.id,
    name: data.name,
    contactName: contact?.contactName ?? null,
    contactEmail: contact?.contactEmail ?? null,
    notes: data.notes,
    isActive: data.is_active,
    workspaceId: data.workspace_id,
  };
}

export async function listClients(workspaceId: string, opts: { withContacts?: boolean } = {}): Promise<Client[]> {
  const supabase = await createClient();
  const [{ data, error }, contacts] = await Promise.all([
    supabase.from("clients").select("id, name, notes, is_active").eq("workspace_id", workspaceId).order("name"),
    opts.withContacts ? contactsFor(workspaceId) : Promise.resolve(new Map<string, { contactName: string | null; contactEmail: string | null }>()),
  ]);
  if (error) throw loadError("Failed to load clients", error);
  return data.map((c) => ({
    id: c.id,
    name: c.name,
    contactName: contacts.get(c.id)?.contactName ?? null,
    contactEmail: contacts.get(c.id)?.contactEmail ?? null,
    notes: c.notes,
    isActive: c.is_active,
  }));
}
