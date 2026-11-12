import "server-only";

import { Resend } from "resend";

import { sendWithRetry, type SendEmailInput, type SendEmailResult } from "./client";

/** True once RESEND_API_KEY is set; emails are skipped (logged, not sent) otherwise. */
export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function fromAddress() {
  return process.env.EMAIL_FROM?.trim() || "team@channeliam.com";
}

/** Sends one email through the account's Resend API key, with retry. Never throws. */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not configured." };
  const resend = new Resend(apiKey);

  return sendWithRetry(async (attempt) => {
    const { error } = await resend.emails.send({
      from: fromAddress(),
      to: attempt.to,
      cc: attempt.cc,
      subject: attempt.subject,
      html: attempt.html,
    });
    if (error) return { ok: false, error: error.message || "Resend rejected the email." };
    return { ok: true };
  }, input);
}
