import "server-only";

/**
 * Logs a failed data load on the server (error code and message only — never
 * the query, request or credentials) and returns the generic error that the
 * page throws. Users see the error boundary; the log line carries the detail.
 */
export function loadError(what: string, cause: { code?: string | null; message?: string | null } | null | undefined): Error {
  console.error(`[data] ${what}:`, cause?.code ?? "no-code", cause?.message ?? "no message");
  return new Error(what);
}
