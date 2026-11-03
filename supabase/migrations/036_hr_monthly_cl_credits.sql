-- 036: Monthly Casual Leave credits (replaces the annual CL allowance check).
--
-- Policy:
--   * 1 CL is credited on the 1st of every month (India time), from the
--     employee's joining month (or the account's creation month).
--   * A credit is valid for 3 calendar months including its credit month
--     (January -> 31 March, December -> end of February, leap years included).
--   * CL days use the oldest valid credit first (FIFO). A leave day can only
--     use a credit that has been credited by that day and has not expired.
--   * At most 12 credits a year: months 1..N where N is the annual CL
--     allowance (hr_leave_policies, or the employee's hr_leave_allowances
--     override for that year), capped at 12.
--   * Pending and approved CL together may never need more credits than exist.
--
-- Nothing is stored: credits, usage and expiry are derived from the leave
-- applications on every call, so history is never rewritten and a holiday
-- added later gives the day's credit back. Existing applications are kept as
-- they are; a new application or approval is refused only if it would leave
-- more CL days uncovered than before (so history decided under the old annual
-- policy never blocks unrelated new requests).

-- Today in India (the company's business timezone).
create or replace function private.hr_today()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- First month an employee receives a CL credit.
create or replace function private.hr_cl_first_month(p_user uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select date_trunc('month', coalesce(h.joining_date, (p.created_at at time zone 'Asia/Kolkata')::date))::date
  from public.profiles p
  left join public.hr_employee_profiles h on h.user_id = p.id
  where p.id = p_user
$$;

-- Last day a credit of this month can be used.
create or replace function private.hr_cl_expiry(p_credit_month date)
returns date
language sql immutable set search_path = ''
as $$
  select (date_trunc('month', p_credit_month) + interval '3 months' - interval '1 day')::date
$$;

-- FIFO allocation of CL days to monthly credits.
-- Counts CL applications whose status is in p_statuses, plus application
-- p_include (any status) and the extra range [p_extra_start, p_extra_end].
-- Returns one row per credit (credit month, expiry, 1 if used) and, on every
-- row, the number of CL days no valid credit could cover (shortfall). With no
-- credits at all it returns a single row with a null credit month.
create or replace function private.hr_cl_allocate(
  p_user uuid,
  p_statuses public.hr_leave_status[],
  p_include uuid default null,
  p_extra_start date default null,
  p_extra_end date default null,
  p_today date default null)
returns table (credit_month date, expires_on date, used integer, shortfall integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  v_first date := private.hr_cl_first_month(p_user);
  v_last date;
  v_offs smallint[] := coalesce((select weekly_off_days from public.hr_settings where id), '{0}'::smallint[]);
  v_months date[] := '{}';
  v_used integer[] := '{}';
  v_short integer := 0;
  v_m date;
  v_cap numeric;
  v_day date;
  v_hit integer;
  i integer;
begin
  if v_first is null then
    return;
  end if;

  -- Credits up to the later of this month and the last CL day considered.
  select date_trunc('month', greatest(v_today, coalesce(max(r.e), v_today)))::date into v_last
  from (
    select a.end_date as e from public.hr_leave_applications a
    where a.user_id = p_user and a.leave_type = 'CL' and (a.status = any(p_statuses) or a.id = p_include)
    union all
    select p_extra_end where p_extra_end is not null
  ) r;

  v_m := v_first;
  while v_m <= v_last loop
    v_cap := least(coalesce(private.hr_leave_allowance(p_user, 'CL', extract(year from v_m)::int), 12), 12);
    if extract(month from v_m) <= v_cap then
      v_months := array_append(v_months, v_m);
      v_used := array_append(v_used, 0);
    end if;
    v_m := (v_m + interval '1 month')::date;
  end loop;

  -- Working CL days in date order; each takes the oldest credit valid that day.
  for v_day in
    select g.d::date
    from (
      select a.start_date as s, a.end_date as e from public.hr_leave_applications a
      where a.user_id = p_user and a.leave_type = 'CL' and (a.status = any(p_statuses) or a.id = p_include)
      union all
      select p_extra_start, p_extra_end where p_extra_start is not null and p_extra_end is not null
    ) r
    cross join lateral generate_series(r.s, r.e, interval '1 day') as g(d)
    where extract(dow from g.d)::smallint <> all (v_offs)
      and not exists (select 1 from public.hr_public_holidays h where h.holiday_date = g.d::date and h.is_active)
    order by 1
  loop
    v_hit := null;
    for i in 1 .. coalesce(array_length(v_months, 1), 0) loop
      if v_used[i] = 0 and v_months[i] <= v_day and v_day <= private.hr_cl_expiry(v_months[i]) then
        v_hit := i;
        exit;
      end if;
    end loop;
    if v_hit is null then
      v_short := v_short + 1;
    else
      v_used[v_hit] := 1;
    end if;
  end loop;

  if coalesce(array_length(v_months, 1), 0) = 0 then
    return query select null::date, null::date, 0, v_short;
    return;
  end if;
  return query
    select m.month, private.hr_cl_expiry(m.month), m.used, v_short
    from unnest(v_months, v_used) as m(month, used);
end;
$$;

create or replace function private.hr_cl_shortfall(
  p_user uuid, p_statuses public.hr_leave_status[], p_include uuid default null,
  p_extra_start date default null, p_extra_end date default null)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(max(a.shortfall), 0)::int
  from private.hr_cl_allocate(p_user, p_statuses, p_include, p_extra_start, p_extra_end) a
$$;

-- Credits as of a date: credited (credit month <= date), unused and not expired.
create or replace function private.hr_cl_available(p_user uuid, p_today date)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int
  from private.hr_cl_allocate(p_user, array['APPROVED', 'PENDING']::public.hr_leave_status[], null, null, null, p_today) a
  where a.credit_month <= p_today and p_today <= a.expires_on and a.used = 0
$$;

-- -----------------------------------------------------------------------------
-- Public: an employee's credits (own, or anyone's for a super admin)
-- -----------------------------------------------------------------------------
create or replace function public.hr_cl_credits(p_user_id uuid default null)
returns table (credit_month date, expires_on date, status text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user uuid := coalesce(p_user_id, (select auth.uid()));
  v_today date := private.hr_today();
begin
  if private.current_user_role() is null then
    raise exception 'Sign in with an active account' using errcode = '42501';
  end if;
  if v_user <> (select auth.uid()) and not private.is_super_admin() then
    raise exception 'You can only see your own leave balance' using errcode = '42501';
  end if;
  -- USED: taken by approved or pending CL. Future credits appear only when a
  -- future CL day already uses them. Shows the last 15 months.
  return query
    select a.credit_month, a.expires_on,
           case when a.used = 1 then 'USED'
                when a.credit_month > v_today then 'UPCOMING'
                when a.expires_on < v_today then 'EXPIRED'
                else 'AVAILABLE' end
    from private.hr_cl_allocate(v_user, array['APPROVED', 'PENDING']::public.hr_leave_status[]) a
    where a.credit_month is not null
      and (a.credit_month <= v_today or a.used = 1)
      and a.credit_month >= (date_trunc('month', v_today) - interval '14 months')::date
    order by a.credit_month;
end;
$$;

revoke all on function public.hr_cl_credits(uuid) from public, anon;
grant execute on function public.hr_cl_credits(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Balance: for CL, allowance = credits received this year so far and
-- available = usable credits today. Other types are unchanged.
-- -----------------------------------------------------------------------------
create or replace function public.hr_leave_balance(p_user_id uuid default null, p_year integer default null)
returns table (leave_type public.hr_leave_type, allowance numeric, approved integer, pending integer, available numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_user uuid := coalesce(p_user_id, (select auth.uid()));
  v_today date := private.hr_today();
  v_year integer := coalesce(p_year, extract(year from v_today)::int);
  v_credited integer;
begin
  if private.current_user_role() is null then
    raise exception 'Sign in with an active account' using errcode = '42501';
  end if;
  if v_user <> (select auth.uid()) and not private.is_super_admin() then
    raise exception 'You can only see your own leave balance' using errcode = '42501';
  end if;
  select count(*)::int into v_credited
  from private.hr_cl_allocate(v_user, array['APPROVED', 'PENDING']::public.hr_leave_status[], null, null, null, v_today) a
  where extract(year from a.credit_month) = v_year and a.credit_month <= v_today;

  return query
    select p.leave_type,
           case when p.leave_type = 'CL' then v_credited::numeric
                else private.hr_leave_allowance(v_user, p.leave_type, v_year) end,
           private.hr_leave_days(v_user, p.leave_type, v_year, 'APPROVED'),
           private.hr_leave_days(v_user, p.leave_type, v_year, 'PENDING'),
           case when p.leave_type = 'CL' then private.hr_cl_available(v_user, v_today)::numeric
                when p.uses_balance
                then private.hr_leave_allowance(v_user, p.leave_type, v_year)
                     - private.hr_leave_days(v_user, p.leave_type, v_year, 'APPROVED')
                     - private.hr_leave_days(v_user, p.leave_type, v_year, 'PENDING')
           end
    from public.hr_leave_policies p
    order by p.leave_type;
end;
$$;

-- -----------------------------------------------------------------------------
-- Apply and approve: CL is checked against the monthly credits.
-- -----------------------------------------------------------------------------
create or replace function public.hr_apply_leave(p_type public.hr_leave_type, p_start date, p_end date, p_reason text)
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
  if v_uid is null or private.current_user_role() is null then
    raise exception 'Sign in with an active account to apply for leave' using errcode = '42501';
  end if;
  if p_type is null or p_start is null or p_end is null then
    raise exception 'Choose a leave type, a start date and an end date.' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'The end date is before the start date.' using errcode = '22023';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'A leave application must stay within one calendar year. Apply separately for each year.' using errcode = '22023';
  end if;
  if char_length(v_reason) not between 3 and 1000 then
    raise exception 'Give a reason (3 to 1000 characters).' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.hr_leave_applications:' || v_uid::text));

  v_days := private.hr_working_days(p_start, p_end);
  if v_days = 0 then
    raise exception 'There are no working days in these dates (Sundays and public holidays are not counted).' using errcode = '22023';
  end if;
  if exists (select 1 from public.hr_leave_applications a
             where a.user_id = v_uid and a.status in ('PENDING', 'APPROVED')
               and daterange(a.start_date, a.end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'You already have a pending or approved application for some of these dates.' using errcode = '23P01';
  end if;
  if p_type = 'CL' then
    v_uncovered := private.hr_cl_shortfall(v_uid, array['APPROVED', 'PENDING']::public.hr_leave_status[], null, p_start, p_end)
                   - private.hr_cl_shortfall(v_uid, array['APPROVED', 'PENDING']::public.hr_leave_status[]);
    if v_uncovered > 0 then
      raise exception 'Not enough Casual Leave: % of % day(s) are not covered by a valid monthly CL credit (% available today).',
        v_uncovered, v_days, private.hr_cl_available(v_uid, private.hr_today()) using errcode = '23514';
    end if;
  elsif (select uses_balance from public.hr_leave_policies where leave_type = p_type) then
    v_available := private.hr_leave_allowance(v_uid, p_type, extract(year from p_start)::int)
                   - private.hr_leave_days(v_uid, p_type, extract(year from p_start)::int, 'APPROVED')
                   - private.hr_leave_days(v_uid, p_type, extract(year from p_start)::int, 'PENDING');
    if v_days > v_available then
      raise exception 'Not enough leave: % day(s) available, % requested.', greatest(v_available, 0), v_days using errcode = '23514';
    end if;
  end if;

  insert into public.hr_leave_applications (user_id, leave_type, start_date, end_date, working_days, reason)
  values (v_uid, p_type, p_start, p_end, v_days, v_reason)
  returning id into v_id;

  perform private.log_attendance(null, 'LEAVE_APPLIED', 'hr_leave_application', v_id, v_uid,
    jsonb_build_object('leave_type', p_type, 'start', p_start, 'end', p_end, 'working_days', v_days));
  return v_id;
end;
$$;

create or replace function public.hr_decide_leave(p_id uuid, p_approve boolean, p_rejection_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_app public.hr_leave_applications;
  v_days integer;
  v_available numeric;
  v_year integer;
  v_uncovered integer;
begin
  if v_uid is null or not private.is_super_admin() then
    raise exception 'Only a super admin can approve or reject leave.' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;

  select * into v_app from public.hr_leave_applications where id = p_id;
  if not found then
    raise exception 'Leave application not found.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.hr_leave_applications:' || v_app.user_id::text));
  select * into v_app from public.hr_leave_applications where id = p_id for update;

  if v_app.user_id = v_uid then
    raise exception 'You cannot approve or reject your own leave application.' using errcode = '42501';
  end if;
  if v_app.status <> 'PENDING' then
    raise exception 'This application has already been decided or cancelled.' using errcode = '55000';
  end if;

  if not p_approve then
    if char_length(btrim(coalesce(p_rejection_reason, ''))) < 3 then
      raise exception 'Give a reason for the rejection (at least 3 characters).' using errcode = '22023';
    end if;
    update public.hr_leave_applications
    set status = 'REJECTED', decided_by = v_uid, decided_at = now(), rejection_reason = btrim(p_rejection_reason), updated_at = now()
    where id = p_id;
    perform private.log_attendance(null, 'LEAVE_REJECTED', 'hr_leave_application', p_id, v_app.user_id,
      jsonb_build_object('reason', btrim(p_rejection_reason)));
    return;
  end if;

  -- Re-count with today's holidays; check credits against approved CL plus this application.
  v_days := private.hr_working_days(v_app.start_date, v_app.end_date);
  if v_days = 0 then
    raise exception 'These dates no longer contain working days (a holiday was added). Reject the application instead.' using errcode = '22023';
  end if;
  if v_app.leave_type = 'CL' then
    v_uncovered := private.hr_cl_shortfall(v_app.user_id, array['APPROVED']::public.hr_leave_status[], p_id)
                   - private.hr_cl_shortfall(v_app.user_id, array['APPROVED']::public.hr_leave_status[]);
    if v_uncovered > 0 then
      raise exception 'Not enough Casual Leave to approve: % of % day(s) are not covered by a valid monthly CL credit.', v_uncovered, v_days using errcode = '23514';
    end if;
  elsif (select uses_balance from public.hr_leave_policies where leave_type = v_app.leave_type) then
    v_year := extract(year from v_app.start_date)::int;
    v_available := private.hr_leave_allowance(v_app.user_id, v_app.leave_type, v_year)
                   - private.hr_leave_days(v_app.user_id, v_app.leave_type, v_year, 'APPROVED');
    if v_days > v_available then
      raise exception 'Not enough leave to approve: % day(s) available, % requested.', greatest(v_available, 0), v_days using errcode = '23514';
    end if;
  end if;

  update public.hr_leave_applications
  set status = 'APPROVED', decided_by = v_uid, decided_at = now(), working_days = v_days, updated_at = now()
  where id = p_id;
  perform private.log_attendance(null, 'LEAVE_APPROVED', 'hr_leave_application', p_id, v_app.user_id,
    jsonb_build_object('working_days', v_days));
end;
$$;

comment on column public.hr_leave_policies.annual_allowance is
  'For CL: monthly credits per year (1 per month, months 1..N, at most 12; 036). Other types: annual days.';
