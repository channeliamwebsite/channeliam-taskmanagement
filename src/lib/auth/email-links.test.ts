import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RESET_REQUESTED, authLinkUrl, confirmErrorCode, confirmRedirect, parseConfirmRequest, resetRequestError } from "./email-links.ts";

const q = (s: string) => new URLSearchParams(s);

describe("parseConfirmRequest", () => {
  it("accepts a token hash for an invitation", () => {
    assert.deepEqual(parseConfirmRequest(q("token_hash=abc&type=invite")), { kind: "token", type: "invite", tokenHash: "abc" });
  });

  it("accepts a token hash for a password reset", () => {
    assert.deepEqual(parseConfirmRequest(q("token_hash=abc&type=recovery")), { kind: "token", type: "recovery", tokenHash: "abc" });
  });

  it("accepts a PKCE code (Supabase's default reset email)", () => {
    assert.deepEqual(parseConfirmRequest(q("code=xyz")), { kind: "code", type: "recovery", code: "xyz" });
  });

  it("reports an expired link that Supabase already rejected", () => {
    assert.deepEqual(parseConfirmRequest(q("error=access_denied&error_code=otp_expired&type=recovery")), { kind: "error", type: "recovery", expired: true });
  });

  it("refuses a token hash with an unknown type", () => {
    assert.deepEqual(parseConfirmRequest(q("token_hash=abc&type=signup")), { kind: "error", type: "recovery", expired: false });
  });

  it("refuses an empty request", () => {
    assert.deepEqual(parseConfirmRequest(q("")), { kind: "error", type: "recovery", expired: false });
  });

  it("an error wins over a token, so a rejected link is never retried", () => {
    assert.equal(parseConfirmRequest(q("token_hash=abc&type=invite&error_code=otp_expired")).kind, "error");
  });
});

describe("confirmErrorCode", () => {
  it("separates invitation and reset failures, expired and invalid", () => {
    assert.equal(confirmErrorCode("invite", false), "link_invalid");
    assert.equal(confirmErrorCode("invite", true), "invite_expired");
    assert.equal(confirmErrorCode("recovery", false), "reset_invalid");
    assert.equal(confirmErrorCode("recovery", true), "reset_expired");
  });
});

describe("authLinkUrl / confirmRedirect", () => {
  it("builds the app's own confirmation link", () => {
    assert.equal(authLinkUrl("https://app.example", "h/a+sh", "recovery"), "https://app.example/auth/confirm?token_hash=h%2Fa%2Bsh&type=recovery");
    assert.equal(authLinkUrl("http://localhost:3000", "x", "invite"), "http://localhost:3000/auth/confirm?token_hash=x&type=invite");
  });

  it("points Supabase back at /auth/confirm on the same origin", () => {
    assert.equal(confirmRedirect("https://app.example"), "https://app.example/auth/confirm");
  });
});

describe("resetRequestError", () => {
  it("shows the generic message for success and for unknown accounts", () => {
    assert.equal(resetRequestError(null), null);
    assert.equal(resetRequestError({ status: 400, message: "User not found" }), null);
    assert.match(RESET_REQUESTED, /If an account exists/);
  });

  it("explains rate limiting", () => {
    assert.match(resetRequestError({ status: 429, code: "over_email_send_rate_limit" }) ?? "", /Too many reset emails/);
    assert.match(resetRequestError({ message: "email rate limit exceeded" }) ?? "", /Too many reset emails/);
  });
});
