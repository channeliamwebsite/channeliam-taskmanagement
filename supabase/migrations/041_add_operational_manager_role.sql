-- =============================================================================
-- 041_add_operational_manager_role.sql   (new role; no data or permission changes)
--
-- Phase 2 (personal workspaces). Adds the fourth role. Postgres forbids using
-- a new enum value in the same transaction that adds it, so this migration
-- does nothing else — every policy/function that references
-- 'OPERATIONAL_MANAGER' ships in a later migration.
-- =============================================================================

alter type public.user_role add value 'OPERATIONAL_MANAGER';
