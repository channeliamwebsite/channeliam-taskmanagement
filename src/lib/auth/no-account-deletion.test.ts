import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

// Offboarding is deactivation (setEmployeeActive). Deleting an account or a
// profile erases work history (see migration 016), so no app code may do it.
const SRC = join(import.meta.dirname, "..", "..");
const FORBIDDEN = [
  { pattern: /\.deleteUser\s*\(/, what: "auth.admin.deleteUser" },
  { pattern: /\.from\(\s*["']profiles["']\s*\)\s*\.delete\s*\(/, what: 'from("profiles").delete()' },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("employee offboarding", () => {
  it("never deletes auth accounts or profiles from app code", () => {
    const files = sourceFiles(SRC);
    assert.ok(files.length > 50, "scans the app source");
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.filter((f) => f.pattern.test(text)).map((f) => `${file}: ${f.what}`);
    });
    assert.deepEqual(hits, []);
  });
});
