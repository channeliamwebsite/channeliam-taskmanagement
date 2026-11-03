import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import { decryptPan, encryptPan, maskAadhaar, maskPan, normalizeAadhaarLast4, normalizePan, panKeyVersion, panLast4 } from "./pan.ts";

const key1 = randomBytes(32);
const key2 = randomBytes(32);
const EMP = "00000000-0000-4000-8000-000000000003";

describe("PAN validation and masking", () => {
  it("normalises a valid PAN and rejects others", () => {
    assert.equal(normalizePan(" abcde1234f "), "ABCDE1234F");
    assert.equal(normalizePan("ABCDE1234"), null);
    assert.equal(normalizePan("1BCDE1234F"), null);
    assert.equal(normalizePan(null), null);
  });
  it("masks the PAN down to its last four characters", () => {
    assert.equal(panLast4("ABCDE1234F"), "234F");
    assert.equal(maskPan("234F"), "XXXXXX234F");
    assert.equal(maskPan(null), "—");
  });
});

describe("Aadhaar: last four digits only", () => {
  it("accepts exactly four digits", () => {
    assert.equal(normalizeAadhaarLast4("1234"), "1234");
    assert.equal(normalizeAadhaarLast4(" 12 34 "), "1234");
  });
  it("refuses a full or partial Aadhaar number and anything non-numeric", () => {
    assert.equal(normalizeAadhaarLast4("1234 5678 9012"), null);
    assert.equal(normalizeAadhaarLast4("123"), null);
    assert.equal(normalizeAadhaarLast4("12a4"), null);
  });
  it("masks it", () => assert.equal(maskAadhaar("1234"), "XXXX XXXX 1234"));
});

describe("PAN encryption (AES-256-GCM)", () => {
  it("round-trips and never contains the plaintext", () => {
    const c = encryptPan("ABCDE1234F", EMP, { version: 1, key: key1 });
    assert.equal(c.includes("ABCDE1234F"), false);
    assert.equal(panKeyVersion(c), 1);
    assert.equal(decryptPan(c, EMP, new Map([[1, key1]])), "ABCDE1234F");
  });
  it("uses a fresh IV each time", () => {
    const k = { version: 1, key: key1 };
    assert.notEqual(encryptPan("ABCDE1234F", EMP, k), encryptPan("ABCDE1234F", EMP, k));
  });
  it("does not decrypt for another employee (bound to the employee id)", () => {
    const c = encryptPan("ABCDE1234F", EMP, { version: 1, key: key1 });
    assert.throws(() => decryptPan(c, "00000000-0000-4000-8000-000000000004", new Map([[1, key1]])));
  });
  it("detects tampering", () => {
    const c = encryptPan("ABCDE1234F", EMP, { version: 1, key: key1 });
    const parts = c.split(":");
    const data = Buffer.from(parts[3]!, "base64");
    data[0] = data[0]! ^ 1;
    parts[3] = data.toString("base64");
    assert.throws(() => decryptPan(parts.join(":"), EMP, new Map([[1, key1]])));
  });
  it("supports key rotation: old values decrypt with their version's key", () => {
    const old = encryptPan("ABCDE1234F", EMP, { version: 1, key: key1 });
    const fresh = encryptPan("PQRST6789Z", EMP, { version: 2, key: key2 });
    const keys = new Map([[1, key1], [2, key2]]);
    assert.equal(decryptPan(old, EMP, keys), "ABCDE1234F");
    assert.equal(decryptPan(fresh, EMP, keys), "PQRST6789Z");
    assert.throws(() => decryptPan(old, EMP, new Map([[2, key2]])), /No key for PAN key version 1/);
  });
  it("refuses a wrong-length key", () => {
    assert.throws(() => encryptPan("ABCDE1234F", EMP, { version: 1, key: randomBytes(16) }));
  });
});
