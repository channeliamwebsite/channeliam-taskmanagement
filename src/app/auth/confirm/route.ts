import { NextResponse, type NextRequest } from "next/server";

import { confirmErrorCode, parseConfirmRequest } from "@/lib/auth/email-links";
import { LOGIN_ROUTE, SET_PASSWORD_ROUTE } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

// Invitation and password-reset links from Supabase Auth land here. Verifying
// the link signs the person in; they then choose a password. Two link styles
// are accepted:
//   * a one-time token hash, from the email templates in supabase/templates
//     (set the same templates on hosted projects) and from admin-generated links:
//       {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|recovery
//   * a PKCE code, from Supabase's default reset email (works in the browser
//     that requested the reset).
// Anything else, or a link Supabase already rejected, goes back to sign-in
// with a message saying whether it was an invitation or a reset and what to do.
export async function GET(request: NextRequest) {
  const link = parseConfirmRequest(request.nextUrl.searchParams);

  const url = request.nextUrl.clone();
  url.search = "";

  if (link.kind !== "error") {
    const supabase = await createClient();
    const { error } =
      link.kind === "token"
        ? await supabase.auth.verifyOtp({ type: link.type, token_hash: link.tokenHash })
        : await supabase.auth.exchangeCodeForSession(link.code);
    if (!error) {
      url.pathname = SET_PASSWORD_ROUTE;
      return NextResponse.redirect(url, { status: 303 });
    }
    // Supabase Auth answers expired, already-used and unknown tokens alike
    // (otp_expired, "invalid or has expired"), so every rejection here is
    // reported as "expired or already used".
    url.pathname = LOGIN_ROUTE;
    url.searchParams.set("error", confirmErrorCode(link.type, true));
    return NextResponse.redirect(url, { status: 303 });
  }

  url.pathname = LOGIN_ROUTE;
  url.searchParams.set("error", confirmErrorCode(link.type, link.expired));
  return NextResponse.redirect(url, { status: 303 });
}
