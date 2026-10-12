import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  DEFAULT_AUTHENTICATED_ROUTE,
  LOGIN_ROUTE,
  isPublicRoute,
  requiresAuth,
} from "@/lib/auth/routes";
import type { Database } from "@/types/database";

import { getSupabaseAnonKey, getSupabaseUrl } from "./env";

/**
 * Runs in `src/proxy.ts` on every matched request:
 *  1. Refreshes the Supabase session and writes updated auth cookies to the
 *     request (for this render) and the response (for the browser).
 *  2. Redirects signed-out users away from protected routes to /login.
 *  3. Redirects signed-in users away from /login.
 *
 * This is an optimistic check based on a verified JWT. Active-status and role
 * checks happen server-side in `src/lib/auth/dal.ts`, and RLS enforces data
 * access in the database.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): getClaims()
  // verifies the JWT and triggers the refresh that keeps users signed in.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;

  if (!isAuthenticated && requiresAuth(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_ROUTE;
    url.search = "";
    if (pathname !== "/") {
      url.searchParams.set("next", `${pathname}${search}`);
    }
    return redirectWithCookies(url, response);
  }

  if (isAuthenticated && isPublicRoute(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = DEFAULT_AUTHENTICATED_ROUTE;
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

/** Redirect while preserving any auth cookies refreshed above. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  from.headers.forEach((value, key) => {
    if (key.toLowerCase() === "cache-control") redirect.headers.set(key, value);
  });
  return redirect;
}
