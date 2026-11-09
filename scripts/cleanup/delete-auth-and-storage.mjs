// Full reset, part 2: Supabase Auth accounts and Storage files, through the
// official Admin and Storage APIs (not SQL). Run AFTER production-full-reset.sql
// has been committed. NOT atomic with the SQL step: if this fails halfway,
// just run it again (already-deleted items are skipped).
//
// Dry run (default; changes nothing):
//   node scripts/cleanup/delete-auth-and-storage.mjs --env <env file> --ref <project ref>
// Delete (only after reviewing the dry run):
//   node scripts/cleanup/delete-auth-and-storage.mjs --env <env file> --ref <project ref> --confirm "DELETE <n> USERS AND <m> FILES FROM <project ref>"
//
// The env file must contain NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// for that project (e.g. .env.staging; for production a separate git-ignored file).
// Never deletes the kept Super Admin; refuses if that account or its active
// SUPER_ADMIN profile is missing; never deletes storage buckets.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const KEEP_EMAILS = ["super-admin-1@example.com", "super-admin-2@example.com"];
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const stop = (msg) => {
  console.error(`STOPPED: ${msg}`);
  process.exit(1);
};
const envFile = arg("--env");
const ref = arg("--ref");
const confirm = arg("--confirm");
if (!envFile || !ref) stop("usage: --env <file> --ref <project ref> [--confirm \"...\"]");

const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes(ref)) stop(`the URL in ${envFile} is not project ${ref}.`);
if (!env.SUPABASE_SERVICE_ROLE_KEY) stop(`SUPABASE_SERVICE_ROLE_KEY missing in ${envFile}.`);
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// --- Plan --------------------------------------------------------------------
const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) stop(`listing users: ${error.message}`);
  users.push(...data.users);
  if (data.users.length < 200) break;
}
const keepIds = new Set();
for (const email of KEEP_EMAILS) {
  const keep = users.find((u) => u.email?.toLowerCase() === email);
  if (!keep) stop(`${email} is not an Auth user on ${ref}.`);
  const { data: keepProfile, error: profileError } = await admin.from("profiles").select("role, is_active").eq("id", keep.id).maybeSingle();
  if (profileError) stop(`reading the Super Admin profile of ${email}: ${profileError.message}`);
  if (keepProfile?.role !== "SUPER_ADMIN" || !keepProfile.is_active) stop(`${email} has no active SUPER_ADMIN profile.`);
  keepIds.add(keep.id);
}
const remove = users.filter((u) => !keepIds.has(u.id));

const { data: buckets, error: bucketError } = await admin.storage.listBuckets();
if (bucketError) stop(`listing buckets: ${bucketError.message}`);
const files = [];
async function walk(bucket, prefix) {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) stop(`listing ${bucket}/${prefix}: ${error.message}`);
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) files.push({ bucket, path });
      else await walk(bucket, path); // folder
    }
    if (data.length < 1000) break;
  }
}
for (const b of buckets) await walk(b.id, "");

console.log(`Project ${ref}. Keeping ${KEEP_EMAILS.join(", ")} (SUPER_ADMIN, active).`);
console.log(`Auth users to delete (${remove.length}):`);
for (const u of remove) console.log(`  ${u.email ?? "(no email)"}  last sign-in ${u.last_sign_in_at ?? "never"}`);
console.log(`Storage files to delete (${files.length}) in ${buckets.length} bucket(s); buckets are kept:`);
for (const f of files) console.log(`  ${f.bucket}/${f.path}`);

const expected = `DELETE ${remove.length} USERS AND ${files.length} FILES FROM ${ref}`;
if (confirm !== expected) {
  console.log(`\nDRY RUN: nothing was changed. To delete exactly this, add:\n  --confirm "${expected}"`);
  process.exit(0);
}

// --- Delete ------------------------------------------------------------------
let ok = 0;
for (const u of remove) {
  if (keepIds.has(u.id)) continue; // never
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) console.error(`  FAILED ${u.email}: ${error.message}`);
  else ok++;
}
const byBucket = Map.groupBy ? Map.groupBy(files, (f) => f.bucket) : new Map(buckets.map((b) => [b.id, files.filter((f) => f.bucket === b.id)]));
let removedFiles = 0;
for (const [bucket, list] of byBucket) {
  for (let i = 0; i < list.length; i += 100) {
    const { data, error } = await admin.storage.from(bucket).remove(list.slice(i, i + 100).map((f) => f.path));
    if (error) console.error(`  FAILED ${bucket}: ${error.message}`);
    else removedFiles += data.length;
  }
}
console.log(`Deleted ${ok}/${remove.length} Auth users and ${removedFiles}/${files.length} files. Now run verify-full-reset.sql.`);
if (ok !== remove.length || removedFiles !== files.length) process.exit(1);
