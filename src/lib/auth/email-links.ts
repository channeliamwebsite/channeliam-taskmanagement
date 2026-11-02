// Email links from Supabase Auth (invitations and password resets), shared by
// the /auth/confirm route, the forgot-password form and the employee actions.
// Pure functions only, so they are unit-tested.

export type AuthLinkType = "invite" | "recovery";

/** What /auth/confirm received. */
export type ConfirmRequest =
  /** Our email templates and admin-generated links: a one-time token hash. */
  | { kind: "token"; type: AuthLinkType; tokenHash: string }
  /** Supabase's default flow (PKCE): a code to exchange in the same browser. */
  | { kind: "code"; type: AuthLinkType; code: string }
  /** Supabase already rejected the link (for example it expired) or it is malformed. */
  | { kind: "error"; type: AuthLinkType; expired: boolean };

const TYPES = new Set<string>(["invite", "recovery"]);

export function parseConfirmRequest(params: URLSearchParams): ConfirmRequest {
  const rawType = params.get("type") ?? "";
  // A link without a recognised type is treated as a reset: the message then
  // points to "Forgot password", which works for every account.
  const type: AuthLinkType = rawType === "invite" ? "invite" : "recovery";
  const errorCode = params.get("error_code") ?? params.get("error");
  if (errorCode) return { kind: "error", type, expired: errorCode === "otp_expired" };

  const tokenHash = params.get("token_hash");
  if (tokenHash && TYPES.has(rawType)) return { kind: "token", type, tokenHash };
  const code = params.get("code");
  if (code) return { kind: "code", type, code };
  return { kind: "error", type, expired: false };
}

/**
 * The ?error= value /login shows for a link that could not be used: "expired"
 * covers every link Supabase Auth rejected (expired, already used or unknown;
 * it reports them the same way), "invalid" a link that is incomplete or malformed.
 */
export function confirmErrorCode(type: AuthLinkType, expired: boolean): string {
  if (type === "invite") return expired ? "invite_expired" : "link_invalid";
  return expired ? "reset_expired" : "reset_invalid";
}

/** The app's own confirmation URL for a hashed token from Supabase Auth. */
export function authLinkUrl(origin: string, hashedToken: string, type: AuthLinkType): string {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", type);
  return url.toString();
}

/** Where Supabase Auth should send people back to after an email link. */
export function confirmRedirect(origin: string): string {
  return new URL("/auth/confirm", origin).toString();
}

/** Shown after every reset request that passes validation, whether or not the account exists. */
export const RESET_REQUESTED =
  "If an account exists for that email, a password reset link is on its way. It works once and expires in one hour.";

/**
 * User-facing message for a failed reset request, or null to show the
 * generic RESET_REQUESTED message (never reveal whether an account exists).
 */
export function resetRequestError(error: { status?: number; code?: string; message?: string } | null): string | null {
  if (!error) return null;
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || /rate limit/i.test(error.message ?? "")) {
    return "Too many reset emails have been sent recently. Please wait a few minutes and try again.";
  }
  return null;
}
