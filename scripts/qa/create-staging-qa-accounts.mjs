// Creates three QA accounts (Super Admin, Admin, Individual) plus a small set of
// sample data on the STAGING Supabase project only. Run it yourself:
//
//   node scripts/qa/create-staging-qa-accounts.mjs
//
// * Reads .env.staging (git-ignored). Refuses unless the URL is the staging
//   project zjldhnfsjdnpeolqxqmc; refuses any production reference.
// * Service role key is used ONLY to create the three users (confirmed, no
//   email sent) and set their role, exactly like supabase/seed.sql does locally.
// * Everything else (workspace, members, client, project, tasks, assignees) is
//   created signed in as the new Super Admin, through RLS and the existing
//   set_task_assignees function: no security is bypassed.
// * Stops if any QA email already exists; never deletes or updates other data.
// * Passwords are random and written to .env.qa-accounts (git-ignored), never printed.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const STAGING_REF = "zjldhnfsjdnpeolqxqmc";
const PRODUCTION_REF = "ptgtsrbaxczphezegial";
const OUT = ".env.qa-accounts";

const env = Object.fromEntries(
  readFileSync(".env.staging", "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
const stop = (msg) => {
  console.error(`STOPPED: ${msg}`);
  process.exit(1);
};
if (!url.includes(STAGING_REF)) stop(`NEXT_PUBLIC_SUPABASE_URL is not the staging project (${STAGING_REF}).`);
if (Object.values(env).some((v) => String(v).includes(PRODUCTION_REF))) stop(".env.staging contains a production reference.");
if (!anon || !service) stop("NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required in .env.staging.");
if (existsSync(OUT)) stop(`${OUT} already exists; the QA accounts seem to be set up already. Not overwriting.`);

const accounts = [
  { key: "SUPER_ADMIN", email: "qa-superadmin@channeliam-qa.test", name: "QA Super Admin", team: null },
  { key: "ADMIN", email: "qa-admin@channeliam-qa.test", name: "QA Admin", team: "QA Team" },
  { key: "INDIVIDUAL", email: "qa-individual@channeliam-qa.test", name: "QA Individual", team: "QA Team" },
];
const password = () => `Qa-${randomBytes(12).toString("base64url")}-1`;

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (step, { error }) => {
  if (error) stop(`${step}: ${error.message}`);
};

// 1. Refuse if any QA account already exists.
const { data: existing, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) stop(`listing users: ${listError.message}`);
const emails = new Set(existing.users.map((u) => u.email?.toLowerCase()));
for (const a of accounts) if (emails.has(a.email)) stop(`${a.email} already exists on staging. Nothing was changed.`);

// 2. Create the users (confirmed, no email) and set role / name / team.
for (const a of accounts) {
  a.password = password();
  const { data, error } = await admin.auth.admin.createUser({
    email: a.email,
    password: a.password,
    email_confirm: true,
    user_metadata: { full_name: a.name },
  });
  if (error || !data.user) stop(`creating ${a.email}: ${error?.message ?? "no user returned"}`);
  a.id = data.user.id;
  must(`setting role for ${a.email}`, await admin.from("profiles").update({ role: a.key, full_name: a.name, team: a.team }).eq("id", a.id));
}
// Save credentials now, so they are not lost if a later step fails.
writeFileSync(
  OUT,
  [
    "# QA accounts on STAGING only (zjldhnfsjdnpeolqxqmc). Git-ignored. Do not share or commit.",
    ...accounts.flatMap((a) => [`QA_${a.key}_EMAIL=${a.email}`, `QA_${a.key}_PASSWORD=${a.password}`]),
    "",
  ].join("\n"),
);

// 3. Sample data, signed in as the QA Super Admin (RLS applies).
const [sa, ad, ind] = accounts;
const user = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
must("signing in as QA Super Admin", await user.auth.signInWithPassword({ email: sa.email, password: sa.password }));

const ws = await user.from("workspaces").insert({ name: "QA Workspace", description: "Browser QA (staging only)", created_by: sa.id }).select("id").single();
must("creating workspace", ws);
const workspaceId = ws.data.id;
must(
  "adding members",
  await user.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: ad.id, can_create_projects: true },
    { workspace_id: workspaceId, user_id: ind.id, can_create_projects: false },
  ]),
);

const client = await user.from("clients").insert({ workspace_id: workspaceId, name: "QA Client Ltd", created_by: sa.id }).select("id").single();
must("creating client", client);
const project = await user
  .from("projects")
  .insert({ workspace_id: workspaceId, name: "QA Website Project", client_id: client.data.id, owner_id: ad.id, created_by: sa.id, status: "ACTIVE" })
  .select("id")
  .single();
must("creating project", project);

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const taskDefs = [
  { title: "QA: Design homepage mock-up", priority: "HIGH", due_date: day(3), assignees: [ad.id, ind.id], primary: ad.id },
  { title: "QA: Write landing page copy", priority: "MEDIUM", due_date: day(1), assignees: [ind.id], primary: ind.id, subtasks: ["QA: Draft headline", "QA: Draft call to action"] },
  { title: "QA: Fix contact form (overdue)", priority: "URGENT", due_date: day(-2), assignees: [ind.id], primary: ind.id },
  { title: "QA: Weekly client update", priority: "LOW", due_date: day(5), assignees: [ad.id], primary: ad.id },
];
const base = { workspace_id: workspaceId, project_id: project.data.id, created_by: sa.id };
let created = 0;
for (const t of taskDefs) {
  const task = await user.from("tasks").insert({ ...base, title: t.title, priority: t.priority, due_date: t.due_date }).select("id").single();
  must(`creating task "${t.title}"`, task);
  must(`assigning "${t.title}"`, await user.rpc("set_task_assignees", { p_task_id: task.data.id, p_user_ids: t.assignees, p_primary_id: t.primary }));
  created++;
  for (const title of t.subtasks ?? []) {
    const sub = await user.from("tasks").insert({ ...base, title, parent_task_id: task.data.id, priority: t.priority, due_date: t.due_date }).select("id").single();
    must(`creating subtask "${title}"`, sub);
    must(`assigning "${title}"`, await user.rpc("set_task_assignees", { p_task_id: sub.data.id, p_user_ids: t.assignees, p_primary_id: t.primary }));
    created++;
  }
}
await user.auth.signOut();

console.log("Done (staging only). Passwords saved to .env.qa-accounts (not printed).");
for (const a of accounts) console.log(`  ${a.key.padEnd(11)} ${a.email}`);
console.log(`  Workspace "QA Workspace", client "QA Client Ltd", project "QA Website Project", ${created} tasks (incl. 2 subtasks, 1 with 2 assignees, 1 overdue).`);
