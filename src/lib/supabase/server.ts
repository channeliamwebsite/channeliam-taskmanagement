import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";

import type { Database } from "@/types/database";

import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Supabase client for Server Components, Server Functions and Route Handlers.
 * Acts as the signed-in user (anon key + session cookie), so RLS applies.
 * Create a new client per request; never share one across requests.
 */
export async function createClient() {
  const cookieStore = await cookies();
  // Auth/session data is per-request: never let it run during (runtime)
  // prerendering, where Supabase's use of Date.now() is rejected.
  await connection();

  return createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: the proxy refreshes the session on every request.
        }
      },
    },
  });
}
