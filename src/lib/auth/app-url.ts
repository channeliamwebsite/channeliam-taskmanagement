// APP_URL parsing, kept free of server-only imports so it is unit-tested.

/**
 * The configured app origin (scheme + host, no path or trailing slash), or
 * null when APP_URL is unset or not an http(s) URL. Plain http is accepted
 * only for local hosts.
 */
export function configuredAppUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}
