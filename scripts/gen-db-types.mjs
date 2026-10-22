// Generates src/types/database.ts from the Supabase schema.
//
// Shell redirection (`> file`) is avoided on purpose: Windows PowerShell 5.1
// writes redirected output as UTF-16, which ESLint rejects as binary. The CLI's
// output is captured here and written as UTF-8 (no BOM, LF line endings).
//
// Usage: node scripts/gen-db-types.mjs --local | --linked [--out <path>]

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const target = args.includes("--linked") ? "--linked" : args.includes("--local") ? "--local" : null;
if (!target) {
  console.error("Usage: node scripts/gen-db-types.mjs --local | --linked [--out <path>]");
  process.exit(1);
}
const outIndex = args.indexOf("--out");
const out = path.resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : "src/types/database.ts");

const cli = path.resolve("node_modules/supabase/dist/supabase.js");
const result = spawnSync(process.execPath, [cli, "gen", "types", "typescript", target, "--schema", "public"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  stdio: ["ignore", "pipe", "inherit"],
});

if (result.error) {
  console.error(`Could not run the Supabase CLI: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  // The CLI reports some errors (e.g. missing privileges) on stdout.
  if (result.stdout.trim()) console.error(result.stdout.trim());
  console.error(`Supabase CLI exited with status ${result.status}; ${path.relative(process.cwd(), out)} was not changed.`);
  process.exit(result.status ?? 1);
}

const types = result.stdout.replace(/^﻿/, "").replace(/\r\n/g, "\n");
// Refuse to overwrite the file with anything that is not the generated types.
if (!types.startsWith("export type Json") || !types.includes("Tables: {")) {
  console.error(`Unexpected CLI output; ${path.relative(process.cwd(), out)} was not changed.`);
  process.exit(1);
}

writeFileSync(out, types.endsWith("\n") ? types : `${types}\n`, { encoding: "utf8" });
console.log(`Wrote ${path.relative(process.cwd(), out)} (${Buffer.byteLength(types, "utf8")} bytes, UTF-8).`);
