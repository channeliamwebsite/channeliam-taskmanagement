-- =============================================================================
-- 051_hr_employee_code_edit.sql
--
-- Lets a super admin correct an employee ID after the fact, through one
-- audited, format- and uniqueness-checked RPC. A direct UPDATE of
-- employee_code is still refused unconditionally (035); only
-- hr_set_employee_code below can change it, and only for a super admin.
-- user_id remains permanently immutable, unconditionally, exactly as before.
--
-- Format change: employee IDs are now IM021 (IM + 3 digits), not CH-0001.
-- The column's CHECK constraint is replaced NOT VALID, so it governs every
-- future insert or update without retroactively rejecting already-issued
-- CH-0001-style IDs -- those are preserved as-is unless a super admin
-- explicitly edits one (hr_set_employee_code then requires the new format,
-- same as any other edit). The default generator (new employees) switches to
-- the new format too, reusing the existing sequence.
-- =============================================================================

alter table public.hr_employee_profiles alter column employee_code
  set default ('IM' || lpad(nextval('public.hr_employee_code_seq')::text, 3, '0'));

alter table public.hr_employee_profiles drop constraint if exists hr_employee_profiles_employee_code_check;
alter table public.hr_employee_profiles add constraint hr_employee_profiles_employee_code_check
  check (employee_code ~ '^IM[0-9]{3}$') not valid;

comment on table public.hr_employee_profiles is
  'HR details per employee (id = profiles.id). employee_code IM021... is assigned once per employee; a direct UPDATE is refused -- only a super admin, through hr_set_employee_code (audited, format- and uniqueness-checked), may change one afterwards.';

-- Same trigger as 035, with one addition: the employee_code guard is lifted
-- only inside a transaction where hr_set_employee_code has just set this
-- session-local flag (cleared again right after its own update), so no
-- other caller -- direct UPDATE included -- can ever get through it.
create or replace function private.audit_hr_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_changed text[];
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Employee IDs cannot be changed.' using errcode = '55000';
  end if;
  if new.employee_code is distinct from old.employee_code
     and coalesce(current_setting('private.allow_employee_code_change', true), '') <> 'on' then
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

-- Super admin only. Validation is the column's own CHECK (format) and UNIQUE
-- (no two employees share an ID) constraints -- the same ones that have
-- always governed this column, just re-pointed at the update above. Audited
-- the same way every other hr_employee_profiles edit is (audit_hr_profile),
-- with the one-change guard lifted for this call only, inside this one
-- transaction, cleared again immediately after.
create or replace function public.hr_set_employee_code(p_user_id uuid, p_employee_code text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_super_admin() then
    raise exception 'Only a super admin can change an employee ID.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.hr_employee_profiles where user_id = p_user_id) then
    raise exception 'Employee not found.' using errcode = 'P0002';
  end if;
  perform set_config('private.allow_employee_code_change', 'on', true);
  update public.hr_employee_profiles set employee_code = p_employee_code where user_id = p_user_id;
  perform set_config('private.allow_employee_code_change', '', true);
end;
$$;

revoke all on function public.hr_set_employee_code(uuid, text) from public, anon;
grant execute on function public.hr_set_employee_code(uuid, text) to authenticated;
