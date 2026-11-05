import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { configuredAppUrl } from "./app-url.ts";

describe("configuredAppUrl (fixed origin for email links)", () => {
  it("returns the origin of the production URL", () => {
    assert.equal(configuredAppUrl("https://taskmanager.likesandshares.com"), "https://taskmanager.likesandshares.com");
    assert.equal(configuredAppUrl(" https://taskmanager.likesandshares.com/login/ "), "https://taskmanager.likesandshares.com");
  });
  it("is null when unset or invalid", () => {
    for (const v of [undefined, "", "  ", "taskmanager.likesandshares.com", "javascript:alert(1)", "ftp://x.example"]) {
      assert.equal(configuredAppUrl(v), null);
    }
  });
  it("allows plain http only for local hosts", () => {
    assert.equal(configuredAppUrl("http://localhost:3000"), "http://localhost:3000");
    assert.equal(configuredAppUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
    assert.equal(configuredAppUrl("http://taskmanager.likesandshares.com"), null);
  });
});
