import "server-only";

import type { PanKey } from "./pan";

// Keys for PAN encryption, from server environment variables only (never
// NEXT_PUBLIC_, never in the database):
//   HR_ENCRYPTION_KEY          current key, 32 random bytes as base64
//   HR_ENCRYPTION_KEY_VERSION  its version number (default 1)
//   HR_ENCRYPTION_KEY_V<n>     earlier keys, kept to decrypt older values after a rotation
// Generate a key with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

function decode(value: string | undefined, name: string): Buffer {
  const key = Buffer.from((value ?? "").trim(), "base64");
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes encoded as base64`);
  return key;
}

export function isPanKeyConfigured() {
  return Boolean(process.env.HR_ENCRYPTION_KEY);
}

export function currentPanKey(): PanKey {
  const version = Number(process.env.HR_ENCRYPTION_KEY_VERSION ?? "1");
  if (!Number.isInteger(version) || version < 1 || version > 999) throw new Error("HR_ENCRYPTION_KEY_VERSION must be 1-999");
  return { version, key: decode(process.env.HR_ENCRYPTION_KEY, "HR_ENCRYPTION_KEY") };
}

/** Every configured key by version (current plus HR_ENCRYPTION_KEY_V<n>). */
export function allPanKeys(): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^HR_ENCRYPTION_KEY_V(\d{1,3})$/.exec(name);
    if (m && value) keys.set(Number(m[1]), decode(value, name));
  }
  const current = currentPanKey();
  keys.set(current.version, current.key);
  return keys;
}
