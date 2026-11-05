import "server-only";

import { headers } from "next/headers";

import { configuredAppUrl } from "./app-url";

/**
 * The app's own URL, for links in auth emails (invitations, password resets).
 * Production links always use APP_URL (https://taskmanager.likesandshares.com),
 * never the address the admin's browser happens to be on (for example a
 * protected *.vercel.app deployment). Only local development, where APP_URL
 * may be unset, falls back to the request's origin.
 */
export async function appOrigin() {
  const fixed = configuredAppUrl(process.env.APP_URL);
  if (fixed) return fixed;
  if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    throw new Error("APP_URL is not configured: email links cannot be created.");
  }
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}
