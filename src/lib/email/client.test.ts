import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sendWithRetry, type EmailSender } from "./client.ts";

const input = { to: "person@example.com", subject: "Subject", html: "<p>Hi</p>" };

describe("sendWithRetry", () => {
  it("returns success on the first attempt without retrying", async () => {
    let calls = 0;
    const send: EmailSender = async () => (calls++, { ok: true });
    const result = await sendWithRetry(send, input, 3, 1);
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 1);
  });

  it("retries a failure and succeeds on a later attempt", async () => {
    let calls = 0;
    const send: EmailSender = async () => {
      calls++;
      return calls < 3 ? { ok: false, error: "temporary" } : { ok: true };
    };
    const result = await sendWithRetry(send, input, 3, 1);
    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 3);
  });

  it("gives up after the configured attempts and returns the last error", async () => {
    let calls = 0;
    const send: EmailSender = async () => (calls++, { ok: false, error: "still down" });
    const result = await sendWithRetry(send, input, 3, 1);
    assert.deepEqual(result, { ok: false, error: "still down" });
    assert.equal(calls, 3);
  });
});
