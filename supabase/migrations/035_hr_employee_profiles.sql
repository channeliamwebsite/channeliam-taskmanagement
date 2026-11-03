-- =============================================================================
-- 035_hr_employee_profiles.sql   (new tables, sequence, functions, storage
-- bucket and policies; backfills one HR profile per existing employee)
--
-- Attendance & HR module, phase 5 (decided 2026-11-03):
--   * One HR profile per existing employee (same id as public.profiles; no new
--     accounts). Name, official email, department (team), designation
--     (job_title) and reporting manager stay in public.profiles.
--   * Employee IDs CH-0001, CH-0002, ... come from a sequence (safe under
--     concurrency), are unique and can never be changed. Existing employees
--     get theirs in order of joining; later ones when their profile is created.
--   * Identity: Aadhaar is stored as its LAST FOUR DIGITS ONLY. PAN is
--     encrypted by the application (AES-256-GCM, key outside the database,
--     key version stored for rotation); the database keeps the ciphertext,
--     which no signed-in role can read, and the last four characters for the
--     masked display. Only super admins set identity data and reveal a PAN,
--     and every reveal is audited before the server decrypts it.
--   * Photos live in the private storage bucket hr-photos (2 MB, JPEG/PNG/WebP)
--     under <employee id>/...; employees read their own, super admins read
--     and manage all; the app serves them through short-lived signed URLs.
--   * Employees read their own HR profile; super admins read and edit all;
--     workspace admins get nothing. Every change is audited (field names only,
--     never values) in attendance_audit_log.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit actions
-- -----------------------------------------------------------------------------
alter table public.attendance_audit_log drop constraint if exists attendance_audit_log_action_check;
alter table public.attendance_audit_log add constraint attendance_audit_log_action_check
  check (action in ('CHECK_IN', 'CHECK_OUT', 'BREAK_START', 'BREAK_END', 'SETTINGS_UPDATED',
                    'LEAVE_APPLIED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED',
                    'LEAVE_POLICY_UPDATED', 'LEAVE_ALLOWANCE_SET',
                    'HOLIDAY_CREATED', 'HOLIDAY_UPDATED', 'HOLIDAY_CANCELLED',
                    'HR_PROFILE_UPDATED', 'IDENTITY_UPDATED', 'PAN_REVEALED'));

-- -----------------------------------------------------------------------------
-- HR profile
-- -----------------------------------------------------------------------------
create sequence if not exists public.hr_employee_code_seq start 1 minvalue 1 no cycle;

create table if not exists public.hr_employee_profiles (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  employee_code      text not null unique default ('CH-' || lpad(nextval('public.hr_employee_code_seq')::text, 4, '0'))
                       check (employee_code ~ '^CH-[0-9]{4,}$'),
  gender             text check (gender in ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED')),
  date_of_birth      date check (date_of_birth between date '1900-01-01' and date '2100-01-01'),
  personal_email     text check (personal_email is null or (char_length(personal_email) <= 254 and personal_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  phone              text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  address            text check (address is null or char_length(address) <= 500),
  joining_date       date check (joining_date is null or joining_date >= date '1990-01-01'),
  employment_status  text not null default 'ACTIVE' check (employment_status in ('ACTIVE', 'PROBATION', 'NOTICE_PERIOD', 'RESIGNED', 'TERMINATED')),
  employment_type    text not null default 'FULL_TIME' check (employment_type in ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN')),
  photo_path         text check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,100}$'),
  created_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now()
);

comment on table public.hr_employee_profiles is
  'HR details per employee (id = profiles.id). employee_code CH-0001... is assigned once and never changes.';

-- Existing employees, in order of joining the app. Never re-numbers anyone.
insert into public.hr_employee_profiles (user_id)
select p.id from public.profiles p
where not exists (select 1 from public.hr_employee_profiles h where h.user_id = p.id)
order by p.created_at, p.id;

-- New employees get theirs with their profile.
create or replace function private.create_hr_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.hr_employee_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_hr_profile on public.profiles;
create trigger create_hr_profile after insert on public.profiles
  for each row execute function private.create_hr_profile();

create or replace function private.audit_hr_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_changed text[];
begin
  if new.employee_code is distinct from old.employee_code or new.user_id is distinct from old.user_id then
    raise exception 'Employee IDs cannot be changed.' using errcode = '55000';
  end if;
  select coalesce(array_agg(key order by key), '{}') into v_changed
  from jsonb_each(to_jsonb(new)) n
  where key not in ('updated_at', 'updated_by') and n.value is distinct from (to_jsonb(old) -> key);
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if cardinality(v_changed) > 0 then
    perform private.log_attendance(null, 'HR_PROFILE_UPDATED', 'hr_employee_profile', null, new.user_id,
      jsonb_build_object('fields', to_jsonb(v_changed)));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_hr_profile on public.hr_employee_profiles;
create trigger audit_hr_profile before update on public.hr_employee_profiles
  for each row execute function private.audit_hr_profile();

alter table public.hr_employee_profiles enable row level security;
drop policy if exists "hr_employee_profiles: own and super admins read" on public.hr_employee_profiles;
create policy "hr_employee_profiles: own and super admins read"
  on public.hr_employee_profiles for select to authenticated
  using (user_id = (select auth.uid()) or private.is_super_admin());
drop policy if exists "hr_employee_profiles: super admins edit" on public.hr_employee_profiles;
create policy "hr_employee_profiles: super admins edit"
  on public.hr_employee_profiles for update to authenticated
  using (private.is_super_admin())
  with check (private.is_super_admin());

revoke all on public.hr_employee_profiles from public, anon, authenticated;
grant select on public.hr_employee_profiles to authenticated;
grant update (gender, date_of_birth, personal_email, phone, address, joining_date, employment_status, employment_type, photo_path)
  on public.hr_employee_profiles to authenticated;
revoke all on sequence public.hr_employee_code_seq from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Identity (PAN ciphertext, last four characters; Aadhaar last four digits)
-- -----------------------------------------------------------------------------
create table if not exists public.hr_employee_identity (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  pan_ciphertext   text check (pan_ciphertext is null or char_length(pan_ciphertext) between 40 and 400),
  pan_key_version  smallint check (pan_key_version is null or pan_key_version between 1 and 999),
  pan_last4        text check (pan_last4 is null or pan_last4 ~ '^[0-9]{3}[A-Z]$'),
  aadhaar_last4    text check (aadhaar_last4 is null or aadhaar_last4 ~ '^[0-9]{4}$'),
  updated_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  constraint hr_employee_identity_pan_complete check ((pan_ciphertext is null) = (pan_key_version is null) and (pan_ciphertext is null) = (pan_last4 is null))
);

comment on table public.hr_employee_identity is
  'Identity data. PAN only as application-encrypted ciphertext (never plaintext) plus its last 4 characters; Aadhaar only as its last 4 digits. pan_ciphertext is not readable by any signed-in role.';

alter table public.hr_employee_identity enable row level security;
drop policy if exists "hr_employee_identity: own and super admins read" on public.hr_employee_identity;
create policy "hr_employee_identity: own and super admins read"
  on public.hr_employee_identity for select to authenticated
  using (user_id = (select auth.uid()) or private.is_super_admin());

revoke all on public.hr_employee_identity from public, anon, authenticated;
-- Masked values only: the ciphertext column is deliberately not granted.
grant select (user_id, pan_last4, aadhaar_last4, updated_at) on public.hr_employee_identity to authenticated;

-- Deactivated accounts get nothing (as 032).
do $$
declare t text;
begin
  foreach t in array array['hr_employee_profiles', 'hr_employee_identity'] loop
    execute format('drop policy if exists %I on public.%I', t || ': active accounts only', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated
                      using ((select private.current_user_role()) is not null)
                      with check ((select private.current_user_role()) is not null)', t || ': active accounts only', t);
  end loop;
end
$$;

-- Sets or clears identity data (super admins only). The PAN arrives already
-- encrypted by the application; nothing here sees or logs plaintext.
create or replace function public.hr_set_identity(
  p_user_id uuid,
  p_pan_ciphertext text,
  p_pan_key_version smallint,
  p_pan_last4 text,
  p_aadhaar_last4 text,
  p_update_pan boolean,
  p_update_aadhaar boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_fields text[] := '{}';
begin
  if not private.is_super_admin() then
    raise exception 'Only a super admin can change identity details.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  insert into public.hr_employee_identity (user_id) values (p_user_id) on conflict (user_id) do nothing;
  if p_update_pan then
    update public.hr_employee_identity
    set pan_ciphertext = p_pan_ciphertext, pan_key_version = p_pan_key_version, pan_last4 = p_pan_last4,
        updated_by = (select auth.uid()), updated_at = now()
    where user_id = p_user_id;
    v_fields := array_append(v_fields, 'pan');
  end if;
  if p_update_aadhaar then
    update public.hr_employee_identity
    set aadhaar_last4 = p_aadhaar_last4, updated_by = (select auth.uid()), updated_at = now()
    where user_id = p_user_id;
    v_fields := array_append(v_fields, 'aadhaar_last4');
  end if;
  if cardinality(v_fields) > 0 then
    perform private.log_attendance(null, 'IDENTITY_UPDATED', 'hr_employee_identity', null, p_user_id,
      jsonb_build_object('fields', to_jsonb(v_fields)));
  end if;
end;
$$;

-- Records a PAN reveal (super admins only, with a reason). The
-- server calls this BEFORE reading and decrypting the ciphertext; if it fails,
-- nothing is revealed.
create or replace function public.hr_log_pan_reveal(p_user_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Only a super admin can view a full PAN.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 200 then
    raise exception 'Give a reason for viewing the full PAN (3 to 200 characters).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.hr_employee_identity where user_id = p_user_id and pan_ciphertext is not null) then
    raise exception 'No PAN is recorded for this employee.' using errcode = 'P0002';
  end if;
  perform private.log_attendance(null, 'PAN_REVEALED', 'hr_employee_identity', null, p_user_id,
    jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

revoke all on function private.create_hr_profile(), private.audit_hr_profile() from public, anon, authenticated;
revoke all on function public.hr_set_identity(uuid, text, smallint, text, text, boolean, boolean), public.hr_log_pan_reveal(uuid, text) from public, anon;
grant execute on function public.hr_set_identity(uuid, text, smallint, text, text, boolean, boolean), public.hr_log_pan_reveal(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Private photo bucket
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-photos', 'hr-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "hr-photos: own and super admins read" on storage.objects;
create policy "hr-photos: own and super admins read"
  on storage.objects for select to authenticated
  using (bucket_id = 'hr-photos' and (select private.current_user_role()) is not null
         and ((storage.foldername(name))[1] = (select auth.uid())::text or private.is_super_admin()));
drop policy if exists "hr-photos: super admins upload" on storage.objects;
create policy "hr-photos: super admins upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-photos' and private.is_super_admin());
drop policy if exists "hr-photos: super admins replace" on storage.objects;
create policy "hr-photos: super admins replace"
  on storage.objects for update to authenticated
  using (bucket_id = 'hr-photos' and private.is_super_admin())
  with check (bucket_id = 'hr-photos' and private.is_super_admin());
drop policy if exists "hr-photos: super admins remove" on storage.objects;
create policy "hr-photos: super admins remove"
  on storage.objects for delete to authenticated
  using (bucket_id = 'hr-photos' and private.is_super_admin());
