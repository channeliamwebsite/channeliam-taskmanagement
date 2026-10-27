import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { LOGIN_ROUTE, SET_PASSWORD_ROUTE } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

// Invitation (and password-recovery) links from Supabase Auth land here with
// a one-time token_hash. Verifying it signs the person in; they then choose a
// password. The Supabase "Invite user" email template must link to:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
const TYPES = new Set<EmailOtpType>(["invite", "recovery"]);

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  const url = request.nextUrl.clone();
  url.search = "";

  if (tokenHash && type && TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      url.pathname = SET_PASSWORD_ROUTE;
      return NextResponse.redirect(url, { status: 303 });
    }
  }

  url.pathname = LOGIN_ROUTE;
  url.searchParams.set("error", "link_invalid");
  return NextResponse.redirect(url, { status: 303 });
}
