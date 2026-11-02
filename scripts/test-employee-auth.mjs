// End-to-end checks of employee accounts against the LOCAL Supabase stack
// (Auth + database), for the parts pgTAP cannot reach because they go through
// Supabase Auth:
//   1. invite link (admin generateLink) -> accept -> choose a password -> sign in;
//   2. password reset link (admin generateLink, type=recovery) -> new password;
//      the old password stops working; a used link cannot be reused;
//   3. reset email (resetPasswordForEmail) is delivered to the local mail
//      catcher and links to the app's /auth/confirm route with type=recovery
//      (needs the recovery template from supabase/config.toml: after changing
//      the template, restart the stack with `npx supabase stop && npx supabase start`);
//   4. deactivation: profile inactive + Auth sign-in block -> sign-in refused
//      and no data reachable with a still-valid token; reactivation restores it;
//   5. optional, when APP_URL is set to a running dev server against the local
//      stack (npm run dev:local): /auth/confirm turns a reset link into a
//      session and redirects to /auth/set-password; a bad link goes to /login
//      with the reset-specific error.
//
// It refuses to run unless `supabase status` reports the local API
// (http://127.0.0.1:<api port from supabase/config.toml>). It creates
// @employee-auth.test accounts and deletes exactly those again.
//
// Usage: node scripts/test-employee-auth.mjs        (APP_URL=http://localhost:3000 optional)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const port = /^\s*port\s*=\s*(\d+)/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
const status = spawnSync("npx", ["supabase", "status", "-o", "env"], { encoding: "utf8", shell: true });
const env = Object.fromEntries([...status.stdout.matchAll(/^([A-Z_]+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]));
const API = env.API_URL;
if (!port || API !== `http://127.0.0.1:${port}` || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
  console.error("REFUSED: the local Supabase stack is not running (npx supabase start).");
  process.exit(2);
}
const mailPort = /^\[local_smtp\][\s\S]*?^\s*port\s*=\s*(\d+)/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
const APP = process.env.APP_URL?.replace(/\/$/, "");
if (APP && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(APP)) {
  console.error("REFUSED: APP_URL must be a local dev server, e.g. http://localhost:3000");
  process.exit(2);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(API, env.SERVICE_ROLE_KEY, opts);
const anon = () => createClient(API, env.ANON_KEY, opts);
const stamp = Date.now();
const created = [];
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const signIn = (email, password) => anon().auth.signInWithPassword({ email, password });

try {
  // 1. Invitation
  const email = `emp-${stamp}@employee-auth.test`;
  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: "Auth Test" } } });
  check("an invite link is created", !invite.error && invite.data.user && invite.data.properties?.hashed_token, invite.error?.message);
  const userId = invite.data.user.id;
  created.push(userId);
  const profile = await admin.from("profiles").select("role, is_active, full_name").eq("id", userId).single();
  check("the invited account gets an active Individual profile", profile.data?.role === "INDIVIDUAL" && profile.data.is_active && profile.data.full_name === "Auth Test");
  const c1 = anon();
  check("the invitation is accepted", !(await c1.auth.verifyOtp({ type: "invite", token_hash: invite.data.properties.hashed_token })).error);
  check("the employee chooses a password", !(await c1.auth.updateUser({ password: "First-Password-1" })).error);
  check("and signs in with it", !(await signIn(email, "First-Password-1")).error);

  // 2. Reset link
  const reset = await admin.auth.admin.generateLink({ type: "recovery", email });
  check("a reset link is created", !reset.error && reset.data.properties?.hashed_token, reset.error?.message);
  const c2 = anon();
  check("the reset link signs the employee in", !(await c2.auth.verifyOtp({ type: "recovery", token_hash: reset.data.properties.hashed_token })).error);
  check("they choose a new password", !(await c2.auth.updateUser({ password: "Second-Password-2" })).error);
  check("the old password no longer works", Boolean((await signIn(email, "First-Password-1")).error));
  check("the new password works", !(await signIn(email, "Second-Password-2")).error);
  const reuse = await anon().auth.verifyOtp({ type: "recovery", token_hash: reset.data.properties.hashed_token });
  check("a used reset link cannot be used again", Boolean(reuse.error), reuse.error?.code);

  // 3. Reset email delivery and link format
  const sent = await anon().auth.resetPasswordForEmail(email, { redirectTo: "http://localhost:3000/auth/confirm" });
  check("a reset email is accepted for sending", !sent.error, sent.error?.message);
  if (mailPort) {
    let link = null;
    for (let i = 0; i < 10 && !link; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const list = await fetch(`http://127.0.0.1:${mailPort}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((r) => r.json()).catch(() => null);
      const msg = list?.messages?.find((m) => /reset/i.test(m.Subject));
      if (msg) {
        const body = await fetch(`http://127.0.0.1:${mailPort}/api/v1/message/${msg.ID}`).then((r) => r.json());
        link = (body.HTML ?? "").match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? null;
      }
    }
    check("the reset email is delivered", Boolean(link));
    if (link) {
      const u = new URL(link);
      check("its link goes to the app's /auth/confirm with type=recovery and a token hash",
        u.pathname === "/auth/confirm" && u.searchParams.get("type") === "recovery" && Boolean(u.searchParams.get("token_hash")),
        u.pathname === "/auth/confirm" ? "" : "default Supabase template still active: restart the local stack to load supabase/templates/recovery.html");
    }
  }

  // 4. Deactivation (what setEmployeeActive does) and reactivation
  const session = await signIn(email, "Second-Password-2");
  const live = createClient(API, env.ANON_KEY, { ...opts, global: { headers: { Authorization: `Bearer ${session.data.session.access_token}` } } });
  await admin.from("profiles").update({ is_active: false }).eq("id", userId);
  const ban = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  check("the sign-in block is applied", !ban.error, ban.error?.message);
  const blocked = await signIn(email, "Second-Password-2");
  check("a deactivated employee cannot sign in", blocked.error?.code === "user_banned", blocked.error?.code);
  const ownRows = await Promise.all(["daily_reports", "notifications", "attendance_sessions", "tasks", "workspace_members"].map((t) => live.from(t).select("*", { count: "exact", head: true })));
  check("a still-valid token reaches no data", ownRows.every((r) => !r.error && r.count === 0), ownRows.map((r) => r.count).join(","));
  const refreshed = await anon().auth.refreshSession({ refresh_token: session.data.session.refresh_token });
  check("and cannot be refreshed", Boolean(refreshed.error), refreshed.error?.code);
  await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
  await admin.from("profiles").update({ is_active: true }).eq("id", userId);
  check("after reactivation they can sign in again", !(await signIn(email, "Second-Password-2")).error);

  // 5. The app's confirm route (optional)
  if (APP) {
    const fresh = await admin.auth.admin.generateLink({ type: "recovery", email });
    const res = await fetch(`${APP}/auth/confirm?token_hash=${encodeURIComponent(fresh.data.properties.hashed_token)}&type=recovery`, { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    const cookies = res.headers.getSetCookie?.() ?? [];
    check("/auth/confirm accepts a reset link and opens Choose a password", res.status === 303 && new URL(location, APP).pathname === "/auth/set-password", `${res.status} ${location}`);
    check("and sets the session cookie", cookies.some((c) => /sb-.*-auth-token/.test(c)));
    const bad = await fetch(`${APP}/auth/confirm?token_hash=not-a-real-token&type=recovery`, { redirect: "manual" });
    const badLoc = new URL(bad.headers.get("location") ?? "/", APP);
    check("a bad reset link goes to sign-in with the reset error", badLoc.pathname === "/login" && badLoc.searchParams.get("error") === "reset_invalid", badLoc.search);
    const expired = await fetch(`${APP}/auth/confirm?error=access_denied&error_code=otp_expired&type=invite`, { redirect: "manual" });
    check("an expired invitation says so", new URL(expired.headers.get("location") ?? "/", APP).searchParams.get("error") === "invite_expired");
  } else {
    console.log("SKIP  /auth/confirm checks (set APP_URL to a local dev server to include them)");
  }
} finally {
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log(`cleanup: could not delete ${id}: ${error.message}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
