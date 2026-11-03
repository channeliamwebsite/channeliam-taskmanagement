// PAN and Aadhaar handling (035). Encryption is pure here (the key is passed
// in) so it can be unit-tested; src/lib/hr/pan-key.ts supplies keys on the
// server only. Never log or return a plaintext PAN except from the audited
// super-admin reveal.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_LAST4 = /^[0-9]{4}$/;

/** Uppercases and strips spaces; null if the result is not a valid PAN. */
export function normalizePan(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pan = value.replace(/\s+/g, "").toUpperCase();
  return PAN.test(pan) ? pan : null;
}

/** Accepts exactly four digits (spaces ignored); never a full Aadhaar number. */
export function normalizeAadhaarLast4(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\s+/g, "");
  return AADHAAR_LAST4.test(digits) ? digits : null;
}

/** "ABCDE1234F" -> "234F" (the part kept for the masked display). */
export function panLast4(pan: string) {
  return pan.slice(-4);
}

export function maskPan(last4: string | null | undefined) {
  return last4 ? `XXXXXX${last4}` : "—";
}

export function maskAadhaar(last4: string | null | undefined) {
  return last4 ? `XXXX XXXX ${last4}` : "—";
}

export type PanKey = { version: number; key: Buffer };

const FORMAT = /^v(\d{1,3}):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

/**
 * AES-256-GCM. The employee id is bound as additional authenticated data, so
 * a ciphertext copied to another employee does not decrypt.
 * Output: v<key version>:<iv>:<auth tag>:<ciphertext> (base64 parts).
 */
export function encryptPan(pan: string, employeeId: string, key: PanKey): string {
  if (key.key.length !== 32) throw new Error("PAN key must be 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(Buffer.from(employeeId, "utf8"));
  const data = Buffer.concat([cipher.update(pan, "utf8"), cipher.final()]);
  return `v${key.version}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

/** The key version a ciphertext was made with, or null if it is not in our format. */
export function panKeyVersion(ciphertext: string): number | null {
  const m = FORMAT.exec(ciphertext);
  return m ? Number(m[1]) : null;
}

/** Decrypts with the key of the ciphertext's version; throws if it was tampered with or belongs to another employee. */
export function decryptPan(ciphertext: string, employeeId: string, keys: ReadonlyMap<number, Buffer>): string {
  const m = FORMAT.exec(ciphertext);
  if (!m) throw new Error("Unrecognised PAN ciphertext");
  const key = keys.get(Number(m[1]));
  if (!key) throw new Error(`No key for PAN key version ${m[1]}`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(m[2]!, "base64"));
  decipher.setAAD(Buffer.from(employeeId, "utf8"));
  decipher.setAuthTag(Buffer.from(m[3]!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(m[4]!, "base64")), decipher.final()]).toString("utf8");
}
