// Route configuration shared by the proxy (edge of every request) and server
// code. Keep this file free of server-only imports.

export const LOGIN_ROUTE = "/login";
export const DEFAULT_AUTHENTICATED_ROUTE = "/my-day";

/** Routes reachable without a session. Everything else requires sign-in. */
export const PUBLIC_ROUTES = [LOGIN_ROUTE] as const;

/** Application areas. Listed explicitly so they are easy to audit. */
export const PROTECTED_ROUTES = [
  "/dashboard",
  "/tasks",
  "/projects",
  "/team",
  "/team-today",
  "/reports",
  "/settings",
] as const;

/** Reachable both signed in and signed out (no redirect either way). */
export const NEUTRAL_ROUTES = ["/auth/signout"] as const;

function matches(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.some((route) => matches(pathname, route));
}

export function isNeutralRoute(pathname: string) {
  return NEUTRAL_ROUTES.some((route) => matches(pathname, route));
}

/**
 * Deny by default: any route that is not public or neutral requires a
 * session, including the explicit PROTECTED_ROUTES and anything added later.
 */
export function requiresAuth(pathname: string) {
  return !isPublicRoute(pathname) && !isNeutralRoute(pathname);
}

/**
 * Sanitises a post-login redirect target so it can only point inside this app
 * (prevents open redirects such as `?next=//evil.example`).
 */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return DEFAULT_AUTHENTICATED_ROUTE;
  }
  if (isPublicRoute(next) || isNeutralRoute(next)) {
    return DEFAULT_AUTHENTICATED_ROUTE;
  }
  return next;
}
