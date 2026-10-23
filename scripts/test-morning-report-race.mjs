// Runs two overlapping morning-report jobs against the LOCAL Supabase database
// (migration 011) and checks that they write one report per member, once.
//
// pgTAP tests run in a single transaction, so a real race needs two sessions.
// This script commits a throwaway workspace with two members, starts two job
// transactions that overlap (each holds its transaction open for 2 s), checks
// the result and always deletes the fixtures again. Local only: it talks to
// the local Docker container, never to a linked project.
//
// Usage: node scripts/test-morning-report-race.mjs

import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync("supabase/config.toml", "utf8"))?.[1];
const container = `supabase_db_${projectId}`;
const psqlArgs = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-tAq"];

const WS = "9f000000-0000-4000-8000-000000000001";
const U1 = "8f000000-0000-4000-8000-000000000001";
const U2 = "8f000000-0000-4000-8000-000000000002";

function sql(text) {
  const r = spawnSync("docker", psqlArgs, { input: text, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || `psql exited with ${r.status}`);
  return r.stdout.trim();
}

function sqlAsync(text) {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", psqlArgs);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err || `psql exited with ${code}`))));
    p.stdin.end(text);
  });
}

const run = `begin;
select private.generate_morning_reports(now(), true, '${WS}');
select pg_sleep(2);
commit;`;

let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? "ok" : "not ok"} - ${label}`);
  if (!ok) failed = true;
};

try {
  sql(`begin;
insert into auth.users (id, email, raw_user_meta_data) values
  ('${U1}', 'race1@race.test', '{"full_name":"Race 1"}'),
  ('${U2}', 'race2@race.test', '{"full_name":"Race 2"}');
insert into public.workspaces (id, name, created_by, timezone) values ('${WS}', 'Race test', '${U1}', 'Asia/Kolkata');
insert into public.workspace_members (workspace_id, user_id) values ('${WS}', '${U2}');
commit;`);
  const members = Number(sql(`select count(*) from public.workspace_members wm join public.profiles p on p.id = wm.user_id and p.is_active where wm.workspace_id = '${WS}'`));

  // Second run starts while the first is still inside its transaction.
  const first = sqlAsync(run);
  await new Promise((r) => setTimeout(r, 300));
  const second = sqlAsync(run);
  const results = (await Promise.all([first, second])).map((o) => Number(o.split(/\s+/)[0]));

  const [rows, withSnapshot, generatedTimes] = sql(`select count(*), count(morning_snapshot), count(distinct morning_generated_at)
    from public.daily_reports where workspace_id = '${WS}'`).split("|").map(Number);

  console.log(`runs wrote ${results.join(" and ")} report(s); ${members} active member(s)`);
  check(results[0] + results[1] === members, "the two overlapping runs wrote one report per member in total");
  check(results.includes(0), "one of the runs wrote nothing");
  check(rows === members && withSnapshot === members, "one report row with a snapshot per member (no duplicates)");
  check(generatedTimes === 1, "every snapshot comes from a single run (none overwritten)");
} catch (e) {
  failed = true;
  console.error(e.message);
} finally {
  sql(`begin;
delete from public.workspaces where id = '${WS}';
delete from auth.users where id in ('${U1}', '${U2}');
commit;`);
  const left = sql(`select (select count(*) from public.workspaces where id = '${WS}') + (select count(*) from auth.users where id in ('${U1}', '${U2}')) + (select count(*) from public.daily_reports where workspace_id = '${WS}')`);
  check(left === "0", "fixtures removed");
}

process.exit(failed ? 1 : 0);
