// Resend-backed email sending for app-triggered notifications (leave
// requests), separate from Supabase Auth's own SMTP (invite/reset), which is
// configured in the Supabase Dashboard. Same Resend account and domain.

export type SendEmailInput = { to: string; cc?: string; subject: string; html: string };
export type SendEmailResult = { ok: true } | { ok: false; error: string };

/** One send attempt. Injected so retry logic and callers are testable without the network. */
export type EmailSender = (input: SendEmailInput) => Promise<SendEmailResult>;

const DEFAULT_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

/**
 * Retries a transient-looking failure with a short linear backoff. Resend's
 * SDK does not expose a reliable "retryable vs. not" classification in its
 * error shape, so every failure is retried up to `attempts` times; the final
 * error is returned unchanged. Never throws.
 */
export async function sendWithRetry(send: EmailSender, input: SendEmailInput, attempts = DEFAULT_ATTEMPTS, delayMs = RETRY_DELAY_MS): Promise<SendEmailResult> {
  let lastError = "Unknown error";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await send(input);
    if (result.ok) return result;
    lastError = result.error;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
  }
  return { ok: false, error: lastError };
}
