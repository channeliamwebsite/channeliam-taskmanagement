-- =============================================================================
-- 022_task_assignee_integrity.sql   (integrity guard; permissions unchanged)
--
-- Who may change assignees is unchanged: task managers only
-- (private.can_manage_task, 002, including the assigned-admin rule, M2) via
-- the RLS policies on task_assignees and public.set_task_assignees (006).
-- What changes is what a manager can leave behind. create_task already
-- requires at least one assignee and a primary, but
--   * set_task_assignees(task, '{}') removed everyone;
--   * deleting the primary assignee (directly, or through the replace-all
--     picker) left the task without a primary;
--   * two managers removing the last two assignees at the same moment could
--     each still see the other one and leave the task empty.
--
-- 1. private.keep_task_assigned (AFTER DELETE ON task_assignees): locks the
--    task row (FOR NO KEY UPDATE, so removals on the same task run one at a
--    time; it does not conflict with the KEY SHARE locks taken by inserts
--    referencing the task), promotes the earliest remaining assignee when the
--    primary was removed, and refuses removing the last assignee
--    ("Assign at least one person", 23514). Removals caused by deleting the
--    task, its project or its workspace are skipped (the task row is gone),
--    and calls without a signed-in user (service role, SQL editor, 016's
--    explicit erasure) are trusted like elsewhere: they may leave a task
--    unassigned but still get a primary promoted.
-- 2. public.set_task_assignees: refuses an empty list, adds new assignees
--    before removing old ones (so a full replacement never passes through
--    "no assignee"), and makes sure a primary remains. Still SECURITY INVOKER:
--    RLS and every trigger apply to the caller.
--
-- Deadlocks: two transactions changing assignees of the same task serialise
-- on the task row; if one of them also already holds another assignee row of
-- that task (multi-statement transactions only), PostgreSQL detects the
-- deadlock and aborts one, which fails safely.
-- =============================================================================

create or replace function private.keep_task_assigned()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_next uuid;
begin
  perform 1 from public.tasks t where t.id = old.task_id for no key update;
  if not found then
    return null; -- the task itself is being deleted
  end if;

  if old.is_primary and not exists (
    select 1 from public.task_assignees ta where ta.task_id = old.task_id and ta.is_primary
  ) then
    select ta.user_id into v_next
    from public.task_assignees ta
    where ta.task_id = old.task_id
    order by ta.assigned_at, ta.user_id
    limit 1;
    if v_next is not null then
      update public.task_assignees set is_primary = true
      where task_id = old.task_id and user_id = v_next;
    end if;
  end if;

  if (select auth.uid()) is not null
     and not exists (select 1 from public.task_assignees ta where ta.task_id = old.task_id) then
    raise exception 'Assign at least one person' using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger keep_task_assigned after delete on public.task_assignees
  for each row execute function private.keep_task_assigned();

create or replace function public.set_task_assignees(p_task_id uuid, p_user_ids uuid[], p_primary_id uuid default null)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ids uuid[];
  v_expected integer;
  v_removed integer;
  v_primary uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not private.can_manage_task(p_task_id) then
    raise exception 'You don''t have permission to assign this task' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct u), '{}') into v_ids from unnest(p_user_ids) u where u is not null;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Assign at least one person' using errcode = '23514';
  end if;

  -- Additions first, so replacing everyone never leaves the task unassigned.
  insert into public.task_assignees (task_id, user_id, assigned_by, is_primary)
  select p_task_id, u, v_uid, false
  from unnest(v_ids) u
  where not exists (select 1 from public.task_assignees ta where ta.task_id = p_task_id and ta.user_id = u);

  select count(*) into v_expected
  from public.task_assignees ta
  where ta.task_id = p_task_id and not (ta.user_id = any (v_ids));

  delete from public.task_assignees ta
  where ta.task_id = p_task_id and not (ta.user_id = any (v_ids));
  get diagnostics v_removed = row_count;
  if v_removed <> v_expected then
    raise exception 'You don''t have permission to remove some assignees' using errcode = '42501';
  end if;

  -- The requested primary, else the current one, else the first of the list.
  v_primary := case when p_primary_id = any (v_ids) then p_primary_id end;
  if v_primary is null and not exists (
    select 1 from public.task_assignees ta where ta.task_id = p_task_id and ta.is_primary
  ) then
    v_primary := v_ids[1];
  end if;
  if v_primary is not null then
    -- The assignee trigger demotes the previous primary.
    update public.task_assignees set is_primary = true
    where task_id = p_task_id and user_id = v_primary and not is_primary;
  end if;
end;
$$;

revoke all on function private.keep_task_assigned() from public, anon, authenticated;
revoke all on function public.set_task_assignees(uuid, uuid[], uuid) from public, anon;
grant execute on function public.set_task_assignees(uuid, uuid[], uuid) to authenticated;
