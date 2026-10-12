import "server-only";

import { createClient } from "@/lib/supabase/server";

export type Client = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  isActive: boolean;
};

export async function getClient(clientId: string): Promise<(Client & { workspaceId: string }) | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, contact_name, contact_email, notes, is_active, workspace_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error("Failed to load client");
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    contactName: data.contact_name,
    contactEmail: data.contact_email,
    notes: data.notes,
    isActive: data.is_active,
    workspaceId: data.workspace_id,
  };
}

export async function listClients(workspaceId: string): Promise<Client[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, contact_name, contact_email, notes, is_active")
    .eq("workspace_id", workspaceId)
    .order("name");
  if (error) throw new Error("Failed to load clients");
  return data.map((c) => ({
    id: c.id,
    name: c.name,
    contactName: c.contact_name,
    contactEmail: c.contact_email,
    notes: c.notes,
    isActive: c.is_active,
  }));
}
