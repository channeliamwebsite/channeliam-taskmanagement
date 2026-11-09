// Restore test helper: decrypts every PAN ciphertext in the given file
// ("<user_id>|v<version>:<iv>:<tag>:<data>" per line) with the key(s) from the
// environment, mirroring src/lib/hr/pan.ts. Prints ONLY counts, never a PAN.
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

const keys = new Map();
const add = (version, value, name) => {
  const key = Buffer.from((value ?? "").trim(), "base64");
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes encoded as base64`);
  keys.set(version, key);
};
add(Number(process.env.HR_ENCRYPTION_KEY_VERSION ?? "1"), process.env.HR_ENCRYPTION_KEY, "HR_ENCRYPTION_KEY");
for (const [name, value] of Object.entries(process.env)) {
  const m = /^HR_ENCRYPTION_KEY_V(\d+)$/.exec(name);
  if (m) add(Number(m[1]), value, name);
}

let ok = 0;
let failed = 0;
for (const line of readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(Boolean)) {
  const [userId, ciphertext] = line.split("|");
  const m = /^v(\d+):([^:]+):([^:]+):([^:]+)$/.exec(ciphertext ?? "");
  try {
    const key = m && keys.get(Number(m[1]));
    if (!key) throw new Error("no key");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(m[2], "base64"));
    d.setAAD(Buffer.from(userId, "utf8"));
    d.setAuthTag(Buffer.from(m[3], "base64"));
    const pan = Buffer.concat([d.update(Buffer.from(m[4], "base64")), d.final()]).toString("utf8");
    if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) ok++;
    else failed++;
  } catch {
    failed++;
  }
}
console.error(`PAN check: ${ok} decrypted, ${failed} failed`);
console.log(String(ok));
