import { NextResponse, type NextRequest } from "next/server";

import { LOGIN_ROUTE } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

// Used by the DAL when a signed-in user must be signed out during a render
// (e.g. deactivated account). Server Components cannot clear cookies, Route
// Handlers can. Only known reasons are forwarded to the login page.
const REASONS = new Set(["account_inactive", "profile_missing"]);

export async function GET(request: NextRequest) {
  // Ignore cross-site triggers (e.g. <img src="/auth/signout">) to prevent
  // logout CSRF. Same-origin redirects from our own pages are allowed.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.redirect(new URL("/", request.url), { status: 303 });
  }

  const supabase = await createClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = LOGIN_ROUTE;
  url.search = "";

  const reason = request.nextUrl.searchParams.get("reason");
  if (reason && REASONS.has(reason)) {
    url.searchParams.set("error", reason);
  }

  return NextResponse.redirect(url, { status: 303 });
}
