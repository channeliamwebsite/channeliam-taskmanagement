import "server-only";

import { headers } from "next/headers";

/** Origin of the current request (the app's own URL), for links in auth emails. */
export async function appOrigin() {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}
