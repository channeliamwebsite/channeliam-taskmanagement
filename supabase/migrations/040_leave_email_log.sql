-- 040: delivery log for leave-notification emails (new request / approved /
-- rejected), sent by the app through Resend (src/lib/email). Separate from
-- the in-app notifications added in 039, which keep working unchanged.
--
-- One row per (application, email_type): the unique constraint means a
-- retried send for the same transition hits a conflict instead of a second
-- email, on top of hr_leave_applications already allowing each transition
-- (submit, approve, reject) to happen only once.

create table if not exists public.hr_leave_email_log (
  id            uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.hr_leave_applications (id) on delete cascade,
  email_type    text not null check (email_type in ('REQUESTED', 'APPROVED', 'REJECTED')),
  status        text not null check (status in ('SENT', 'FAILED')),
  error         text check (error is null or char_length(error) <= 1000),
  created_at    timestamptz not null default now(),
  constraint hr_leave_email_log_one_per_transition unique (application_id, email_type)
);

comment on table public.hr_leave_email_log is
  'Delivery log for leave-notification emails (Resend). Written by the app after hr_apply_leave / hr_decide_leave succeeds; never blocks the leave workflow.';

alter table public.hr_leave_email_log enable row level security;

drop policy if exists "hr_leave_email_log: super admins read" on public.hr_leave_email_log;
create policy "hr_leave_email_log: super admins read"
  on public.hr_leave_email_log for select to authenticated
  using (private.is_super_admin());

-- Insert allowed only for an application the caller can already see
-- (applicant logging their own "request submitted" email, or a super admin
-- logging an approve/reject email) -- mirrors hr_leave_applications' own
-- read policy rather than introducing a new access model.
drop policy if exists "hr_leave_email_log: insert for visible applications" on public.hr_leave_email_log;
create policy "hr_leave_email_log: insert for visible applications"
  on public.hr_leave_email_log for insert to authenticated
  with check (
    exists (
      select 1 from public.hr_leave_applications a
      where a.id = application_id and (a.user_id = (select auth.uid()) or private.is_super_admin())
    )
  );

-- Deactivated accounts get nothing from any HR table (as 032/034).
drop policy if exists "hr_leave_email_log: active accounts only" on public.hr_leave_email_log;
create policy "hr_leave_email_log: active accounts only" on public.hr_leave_email_log as restrictive for all to authenticated
  using ((select private.current_user_role()) is not null)
  with check ((select private.current_user_role()) is not null);

revoke all on public.hr_leave_email_log from public, anon, authenticated;
grant select, insert on public.hr_leave_email_log to authenticated;
