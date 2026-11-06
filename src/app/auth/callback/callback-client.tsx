"use client";

import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { confirmErrorCode, parseAuthFragment, passwordPageFor, type AuthLinkType } from "@/lib/auth/email-links";
import { LOGIN_ROUTE } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/client";

/**
 * Finishes invitation / password-reset links whose session is in the URL
 * fragment (Supabase's default templates and admin-generated links). The
 * fragment never reaches the server, so this runs in the browser: it stores the
 * session (cookies, via the Supabase SSR browser client) and opens the right
 * password page. Tokens are removed from the address bar first.
 */
export function AuthCallback() {
  useEffect(() => {
    const { hash, search } = window.location;
    const queryType: AuthLinkType = new URLSearchParams(search).get("type") === "invite" ? "invite" : "recovery";
    window.history.replaceState(null, "", window.location.pathname);
    const link = parseAuthFragment(hash);
    const fail = (type: AuthLinkType, expired: boolean) =>
      window.location.replace(`${LOGIN_ROUTE}?error=${confirmErrorCode(type, expired)}`);

    if (!link) return fail(queryType, false);
    if (link.kind === "error") return fail(link.type, link.expired);

    void createClient()
      .auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
      .then(({ error }) => {
        if (error) fail(link.type, true);
        // Full navigation so the server sees the new session cookies.
        else window.location.replace(passwordPageFor(link.type));
      });
  }, []);

  return (
    <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Verifying your link…
    </p>
  );
}
