-- =============================================================================
-- 050_safe_cascade_task_deletion.sql   (deletion behaviour change only: no
-- RLS, permission, role or schema/FK changes)
--
-- A task (or any task someone is already allowed to delete) and its
-- subtasks, at any nesting depth, may now be deleted together in one atomic
-- operation -- as long as nothing in that whole subtree is the kind of
-- history 027 already protects: comments, attachments, logged time, or a
-- reference from a daily report or meeting follow-up. The latter two have
-- no foreign key to tasks, so a dangling id there would otherwise be silent
-- and permanent; that part of 027's protection is unchanged, just checked
-- across the whole subtree instead of one task.
--
-- Before this, 027's protect_task_history refused to delete any task that
-- had even one subtask at all, full stop -- cancelling was the only way to
-- retire a task with subtasks, even fresh ones with no history of their own.
--
-- tasks.parent_task_id, task_comments.task_id, task_attachments.task_id,
-- time_entries.task_id, task_assignees.task_id and task_dependencies.* are
-- already `on delete cascade` (001); unlimited nesting already cascades
-- correctly on its own once the trigger lets the delete through. No FK or
-- schema change is needed. Cycles in parent_task_id are already rejected on
-- every insert/update (003), so the recursive subtree walk below never
-- needs its own cycle guard.
--
-- Trigger re-entrancy: deleting the targeted task causes Postgres to
-- cascade-delete every descendant row via that same FK, which fires this
-- same BEFORE DELETE trigger again for each one. Two independent signals
-- distinguish "the row this DELETE statement actually targeted" from "a row
-- removed only as a consequence of that same statement":
--   1. pg_trigger_depth() is 1 while this trigger runs for the targeted row
--      (nothing else caused that invocation -- the trigger's own invocation
--      already counts as depth 1, so depth is NEVER 0 inside a trigger body;
--      checking depth = 0 would never be true and would silently disable the
--      whole check). It is >1 for every row removed by the cascade, because
--      that deletion happens from inside the FK's own constraint trigger,
--      one level further in. The standard, well-known Postgres idiom for
--      "skip this for nested/cascaded invocations" is `pg_trigger_depth() >
--      1`, not depth = 0.
--   2. Independently (belt and suspenders -- this is consequential enough
--      not to rely on trigger-depth semantics alone): a row is also a
--      cascade descendant whenever it has a parent_task_id that no longer
--      resolves to an existing row within this same statement -- the exact
--      pattern private.log_task_deleted (017) already uses for the same
--      purpose, with the same reasoning (the parent was already removed
--      earlier in this same statement/transaction, so it is correctly
--      invisible to this later check).
-- Either signal alone is enough to skip the (redundant) check; the full
-- subtree is validated exactly once, for the originally-targeted row.
--
-- Audited (grep across every migration) that neither signal can skip the
-- check for a genuine, direct, user-requested deletion: no function or
-- trigger anywhere in this schema issues `delete from tasks` itself --
-- public.tasks rows are only ever removed by the app's single-id
-- `deleteTask` action (always depth 1, nothing else involved) or by FK
-- cascade from a parent task or the whole workspace being deleted (the
-- latter already short-circuits above, via the "workspace still exists"
-- check, unchanged from 027). log_task_deleted (017) is AFTER DELETE and
-- only writes an audit row; it never deletes anything itself. A task's
-- parent_task_id can only stop resolving mid-statement if that parent is
-- being deleted in this same statement (parent_task_id is itself `on
-- delete cascade`, so a child can never otherwise outlive a deleted
-- parent) -- and even in the contrived case of one `delete ... where id in
-- (parent, child)` naming both explicitly (not a path this app's code ever
-- takes), whichever of the two is processed first is still fully
-- validated on its own turn, while the other either sees its ancestor
-- still present (validated independently) or was already covered by the
-- ancestor's own subtree walk run while it still existed. Nothing in this
-- schema can reach either signal's skip branch without the row actually
-- being a cascade consequence of an already-validated delete.
--
-- Atomicity: the whole subtree is computed and validated inside the BEFORE
-- trigger of the row the DELETE statement targets, before any row -- that
-- one or any descendant -- has actually been removed. Raising an exception
-- there aborts the entire statement: nothing is deleted, not even an
-- unrelated clean sibling subtask. This is how Postgres statements already
-- work; no application-level transaction wrapping is needed.
-- =============================================================================

create or replace function private.task_set_has_kept_history(p_ids uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.task_comments c where c.task_id = any (p_ids))
      or exists (select 1 from public.task_attachments a where a.task_id = any (p_ids))
      or exists (select 1 from public.time_entries e where e.task_id = any (p_ids))
$$;

-- Same two checks task_has_history (027) already made, generalised from one
-- task id to a whole set: daily_reports and meeting_records have no foreign
-- key to tasks, so a referenced task's deletion must be refused, not left
-- to leave a dangling id.
create or replace function private.task_set_has_protected_references(p_ids uuid[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.daily_reports r
    where exists (
      select 1 from unnest(p_ids) as tid
      where tid = any (r.planned_task_ids)
         or tid = any (r.linked_task_ids)
         or r.evening_snapshot -> 'tasks' @> jsonb_build_array(jsonb_build_object('id', tid))
         or r.morning_snapshot -> 'tasks' @> jsonb_build_array(jsonb_build_object('id', tid))
    )
  )
  or exists (
    select 1 from public.meeting_records m
    where exists (select 1 from unnest(p_ids) as tid where tid = any (m.follow_up_task_ids))
  )
$$;

create or replace function private.protect_task_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_subtree uuid[];
begin
  -- Trusted calls without a signed-in user, and removal of the whole workspace (unchanged, 027).
  if (select auth.uid()) is null
     or not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old;
  end if;

  -- A cascade descendant of this same DELETE statement (see the header for why
  -- there are two independent signals): already covered by the check below,
  -- which ran once for the row this statement actually targeted.
  if pg_trigger_depth() > 1
     or (old.parent_task_id is not null and not exists (select 1 from public.tasks t where t.id = old.parent_task_id)) then
    return old;
  end if;

  -- The row the statement actually targeted: validate its complete subtree
  -- (itself plus every nested descendant, unlimited depth) once, before
  -- anything is deleted.
  with recursive subtree as (
    select old.id as id
    union all
    select t.id from public.tasks t join subtree s on t.parent_task_id = s.id
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_subtree from subtree;

  if private.task_set_has_kept_history(v_subtree) then
    raise exception 'This task or one of its subtasks has comments, attachments or logged time. Cancel it instead of deleting it.'
      using errcode = '55000';
  end if;

  if private.task_set_has_protected_references(v_subtree) then
    raise exception 'This task or one of its subtasks is named in a daily report or meeting follow-up. Cancel it instead of deleting it.'
      using errcode = '55000';
  end if;

  return old;
end;
$$;

-- Internal helpers, called only from inside protect_task_history (itself
-- security definer, so it runs -- and calls these -- as its owner, who keeps
-- the implicit privilege to execute its own functions regardless of this
-- revoke). No signed-in role ever needs to call either of these directly.
revoke all on function private.task_set_has_kept_history(uuid[]), private.task_set_has_protected_references(uuid[]) from public, anon, authenticated;
