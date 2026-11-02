-- Own daily-report history (Stage 1): an employee reads every one of their own
-- reports, month by month, in the active workspace — not only the latest ten —
-- and nobody else's. No permission changes: this pins the existing rules
-- (002 read policy, 010 write lockdown) that the history view relies on.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Fixtures (as postgres)
--   iv  = employee whose history is shown (member of W1 and W2)
--   col = colleague in W1
--   ad2 = admin of W2 only
insert into auth.users (id, email, raw_user_meta_data) values
  ('c7000000-0000-4000-8000-000000000001', 'iv@rh.test', '{"full_name":"Ivy History"}'),
  ('c7000000-0000-4000-8000-000000000002', 'col@rh.test', '{"full_name":"Colleague"}'),
  ('c7000000-0000-4000-8000-000000000003', 'ad2@rh.test', '{"full_name":"Other Admin"}'),
  ('c7000000-0000-4000-8000-000000000004', 'sa@rh.test', '{"full_name":"Super"}');
update public.profiles set role = 'ADMIN' where id = 'c7000000-0000-4000-8000-000000000003';
update public.profiles set role = 'SUPER_ADMIN' where id = 'c7000000-0000-4000-8000-000000000004';
insert into public.workspaces (id, name, created_by) values
  ('c8000000-0000-4000-8000-000000000001', 'RH One', 'c7000000-0000-4000-8000-000000000004'),
  ('c8000000-0000-4000-8000-000000000002', 'RH Two', 'c7000000-0000-4000-8000-000000000004');
insert into public.workspace_members (workspace_id, user_id) values
  ('c8000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001'),
  ('c8000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002'),
  ('c8000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001'),
  ('c8000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000003');

-- 12 reports for iv in W1 over three months (more than the old 10-row card),
-- one with no evening snapshot (as before migration 009); 1 for iv in W2;
-- 2 for the colleague in W1.
insert into public.daily_reports (user_id, workspace_id, report_date, accomplishments, morning_submitted_at, evening_submitted_at)
select 'c7000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', d::date,
       'Work on ' || d::date, d + interval '9 hours', d + interval '18 hours'
from (values ('2026-07-01'::timestamptz), ('2026-07-02'), ('2026-07-03'), ('2026-07-31'),
             ('2026-08-03'), ('2026-08-04'), ('2026-08-05'), ('2026-08-31'),
             ('2026-09-01'), ('2026-09-02'), ('2026-09-15'), ('2026-09-30')) v(d);
insert into public.daily_reports (user_id, workspace_id, report_date, accomplishments, evening_submitted_at) values
  ('c7000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000002', '2026-08-04', 'Other workspace', '2026-08-04 18:00+05:30'),
  ('c7000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000001', '2026-08-04', 'Colleague work', '2026-08-04 18:00+05:30'),
  ('c7000000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000001', '2026-09-02', 'Colleague work', '2026-09-02 18:00+05:30');

set local role authenticated;

-- The employee: full history, month by month, in the active workspace
set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports
           where workspace_id = 'c8000000-0000-4000-8000-000000000001' and user_id = 'c7000000-0000-4000-8000-000000000001'),
  12, 'employee reads all 12 of their own reports in the workspace, beyond the latest 10');
select is((select array_agg(n order by m)::int[] from (
           select date_trunc('month', report_date) m, count(*) n from public.daily_reports
           where workspace_id = 'c8000000-0000-4000-8000-000000000001' and user_id = 'c7000000-0000-4000-8000-000000000001'
             and report_date between '2026-07-01' and '2026-09-30'
           group by 1) s),
  array[4, 4, 4], 'each month of history is complete, including the first and last day of the month');
select is((select count(*)::int from public.daily_reports
           where workspace_id = 'c8000000-0000-4000-8000-000000000001' and user_id = 'c7000000-0000-4000-8000-000000000001'
             and report_date between '2026-08-01' and '2026-08-31'),
  4, 'the history query for one month returns only that workspace''s reports (not the other workspace''s)');
select is((select count(*)::int from public.daily_reports where user_id = 'c7000000-0000-4000-8000-000000000002'),
  0, 'employee cannot read a colleague''s reports');
select is((select count(*)::int from public.daily_reports), 13,
  'everything the employee can read is their own (12 in W1, 1 in W2)');

-- Writes stay locked down (010), including to one's own historical reports
select throws_ok($$
  insert into public.daily_reports (user_id, workspace_id, report_date)
  values ('c7000000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001', '2026-06-30')
$$, '42501', null, 'employee cannot insert a backdated report');
select throws_ok($$
  update public.daily_reports set accomplishments = 'rewritten' where report_date = '2026-07-01'
$$, '42501', null, 'employee cannot rewrite a historical report');
select throws_ok($$
  delete from public.daily_reports where report_date = '2026-07-01'
$$, '42501', null, 'employee cannot delete a historical report');

-- The colleague sees only their own
set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports where user_id = 'c7000000-0000-4000-8000-000000000001'),
  0, 'colleague cannot read the employee''s history');
select is((select count(*)::int from public.daily_reports), 2, 'colleague reads only their own two reports');

-- An admin of another workspace: workspace isolation
set local request.jwt.claims to '{"sub":"c7000000-0000-4000-8000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.daily_reports where workspace_id = 'c8000000-0000-4000-8000-000000000001'),
  0, 'an admin of another workspace cannot read this workspace''s reports');
select is((select count(*)::int from public.daily_reports where workspace_id = 'c8000000-0000-4000-8000-000000000002'),
  1, 'the admin reads their own workspace''s report (existing rule unchanged)');
select throws_ok($$
  update public.daily_reports set accomplishments = 'admin edit' where workspace_id = 'c8000000-0000-4000-8000-000000000002'
$$, '42501', null, 'the admin cannot edit reports either');

select * from finish();
rollback;
