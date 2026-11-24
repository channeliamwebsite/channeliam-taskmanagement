-- =============================================================================
-- 052_hr_record_leave.sql
--
-- Lets a super admin record leave on an employee's behalf, already decided:
-- hr_record_leave inserts straight into hr_leave_applications as APPROVED,
-- with decided_by/decided_at set to the recording super admin and now() --
-- the same two columns that already track who approved a normal application
-- and when, reused here rather than adding new ones. Validation mirrors
-- hr_apply_leave exactly (same date/reason checks, the same overlap guard,
-- and the same monthly CL credit/FIFO shortfall check from 036 -- no balance
-- override), so a recorded leave is indistinguishable from an approved one
-- except for how it got there. A super admin cannot record leave for
-- themselves (consistent with hr_decide_leave's "never your own" rule, and
-- with Super Admin not applying for leave at all, 2026-11-06).
--
-- Existing apply/cancel/decide paths, and every balance/credit calculation,
-- are untouched -- this only adds one more way to reach the same table
-- through the same constraints.
-- =============================================================================

alter table public.attendance_audit_log drop constraint if exists attendance_audit_log_action_check;
alter table public.attendance_audit_log add constraint attendance_audit_log_action_check
  check (action in ('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END', 'SETTINGS_UPDATED',
                    'LEAVE_APPLIED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED', 'LEAVE_RECORDED',
                    'LEAVE_POLICY_UPDATED', 'LEAVE_ALLOWANCE_SET',
                    'HOLIDAY_CREATED', 'HOLIDAY_UPDATED', 'HOLIDAY_CANCELLED',
                    'HR_PROFILE_UPDATED', 'IDENTITY_UPDATED', 'PAN_REVEALED'));

create or replace function public.hr_record_leave(p_user_id uuid, p_type public.hr_leave_type, p_start date, p_end date, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_days integer;
  v_available numeric;
  v_uncovered integer;
  v_id uuid;
begin
  if v_uid is null or not private.is_super_admin() then
    raise exception 'Only a super admin can record leave.' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'You cannot record leave for yourself.' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id and is_active) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  if p_type is null or p_start is null or p_end is null then
    raise exception 'Choose a leave type, a start date and an end date.' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'The end date is before the start date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave record must stay within one calendar year. Record separately for each year.' using errcode = '22023';
  end if;
  if char_length(v_reason) not between 3 and 1000 then
    raise exception 'Give a reason (3 to 1000 characters).' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.hr_leave_applications:' || p_user_id::text));

  v_days := private.hr_working_days(p_start, p_end);
  if v_days = 0 then
    raise exception 'There are no working days in these dates (Sundays and public holidays are not counted).' using errcode = '22023';
  end if;
  if exists (select 1 from public.hr_leave_applications a
             where a.user_id = p_user_id and a.status in ('PENDING', 'APPROVED')
               and daterange(a.start_date, a.end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'This employee already has a pending or approved application for some of these dates.' using errcode = '23P01';
  end if;
  -- Same balance rule as hr_apply_leave/hr_decide_leave (036): CL against
  -- monthly credits (FIFO), everything else against hr_leave_policies'
  -- annual allowance. No override for a super-admin-recorded entry.
  if p_type = 'CL' then
    v_uncovered := private.hr_cl_shortfall(p_user_id, array['APPROVED', 'PENDING']::public.hr_leave_status[], null, p_start, p_end)
                   - private.hr_cl_shortfall(p_user_id, array['APPROVED', 'PENDING']::public.hr_leave_status[]);
    if v_uncovered > 0 then
      raise exception 'Not enough Casual Leave: % of % day(s) are not covered by a valid monthly CL credit (% available today).',
        v_uncovered, v_days, private.hr_cl_available(p_user_id, private.hr_today()) using errcode = '23514';
    end if;
  elsif (select uses_balance from public.hr_leave_policies where leave_type = p_type) then
    v_available := private.hr_leave_allowance(p_user_id, p_type, extract(year from p_start)::int)
                   - private.hr_leave_days(p_user_id, p_type, extract(year from p_start)::int, 'APPROVED')
                   - private.hr_leave_days(p_user_id, p_type, extract(year from p_start)::int, 'PENDING');
    if v_days > v_available then
      raise exception 'Not enough leave: % day(s) available, % requested.', greatest(v_available, 0), v_days using errcode = '23514';
    end if;
  end if;

  insert into public.hr_leave_applications (user_id, leave_type, start_date, end_date, working_days, reason, status, decided_by, decided_at)
  values (p_user_id, p_type, p_start, p_end, v_days, v_reason, 'APPROVED', v_uid, now())
  returning id into v_id;

  perform private.log_attendance(null, 'LEAVE_RECORDED', 'hr_leave_application', v_id, p_user_id,
    jsonb_build_object('leave_type', p_type, 'start', p_start, 'end', p_end, 'working_days', v_days));
  return v_id;
end;
$$;

revoke all on function public.hr_record_leave(uuid, public.hr_leave_type, date, date, text) from public, anon;
grant execute on function public.hr_record_leave(uuid, public.hr_leave_type, date, date, text) to authenticated;

-- Notifications (039): the INSERT branch used to fire unconditionally,
-- telling every super admin an application needed review even when
-- hr_record_leave inserts one that is already decided. Gate that ping on
-- actually being PENDING, and tell the employee instead when their leave
-- arrives already recorded -- same LEAVE_DECIDED type and dedupe_key shape
-- the existing decided-while-pending branch below already uses, so a
-- leave application is never both "submitted" and "decided" at once.
create or replace function private.notify_leave_application()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  v_kind text := case new.leave_type::text when 'CL' then 'casual leave' when 'LWP' then 'leave without pay' when 'WFH' then 'work from home' else lower(new.leave_type::text) end;
  v_dates text := case when new.start_date = new.end_date then to_char(new.start_date, 'DD Mon YYYY')
                       else to_char(new.start_date, 'DD Mon') || ' – ' || to_char(new.end_date, 'DD Mon YYYY') end;
begin
  if tg_op = 'INSERT' and new.status = 'PENDING' then
    select coalesce(nullif(trim(p.full_name), ''), p.email) into v_name from public.profiles p where p.id = new.user_id;
    insert into public.notifications (user_id, type, title, message, dedupe_key)
    select sa.id, 'LEAVE_SUBMITTED', 'Leave application to review',
           format('%s applied for %s (%s, %s working day%s).', v_name, v_kind, v_dates, new.working_days,
                  case when new.working_days = 1 then '' else 's' end),
           'leave-submitted:' || new.id
    from public.profiles sa
    where sa.role = 'SUPER_ADMIN' and sa.is_active and sa.id <> new.user_id
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  elsif tg_op = 'INSERT' and new.status = 'APPROVED' then
    insert into public.notifications (user_id, type, title, message, dedupe_key)
    values (new.user_id, 'LEAVE_DECIDED', 'Leave recorded',
            format('%s for %s was recorded on your behalf (%s working day%s).',
                   initcap(v_kind), v_dates, new.working_days, case when new.working_days = 1 then '' else 's' end),
            'leave-decided:' || new.id)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'PENDING' and new.status in ('APPROVED', 'REJECTED') then
    insert into public.notifications (user_id, type, title, message, dedupe_key)
    values (new.user_id, 'LEAVE_DECIDED',
            case when new.status = 'APPROVED' then 'Leave approved' else 'Leave rejected' end,
            case when new.status = 'APPROVED' then format('Your %s for %s was approved.', v_kind, v_dates)
                 else format('Your %s for %s was rejected: %s', v_kind, v_dates, coalesce(new.rejection_reason, 'no reason given')) end,
            'leave-decided:' || new.id)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return null;
end;
$$;
