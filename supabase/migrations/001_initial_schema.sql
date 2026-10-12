-- =============================================================================
-- 001_initial_schema.sql
-- Core schema: enums, tables, keys and constraints.
-- RLS lives in 002, triggers + indexes in 003.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('SUPER_ADMIN', 'ADMIN', 'INDIVIDUAL');

create type public.project_status as enum ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- Shared by projects and tasks.
create type public.priority_level as enum ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

create type public.task_status as enum ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED', 'CANCELLED');

create type public.task_type as enum (
  'TASK', 'BUG', 'FEATURE', 'CONTENT', 'DESIGN', 'DEVELOPMENT', 'SEO', 'MARKETING', 'MEETING', 'OTHER'
);

-- A row (task_id, depends_on_task_id) always reads "task_id depends on depends_on_task_id",
-- i.e. depends_on_task_id BLOCKS task_id and task_id is BLOCKED_BY depends_on_task_id.
-- The type describes the scheduling link (standard Gantt semantics) for timeline views.
create type public.dependency_type as enum (
  'FINISH_TO_START',  -- default: predecessor must finish before this task starts
  'START_TO_START',
  'FINISH_TO_FINISH',
  'START_TO_FINISH'
);

create type public.activity_action as enum (
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_ASSIGNED',
  'TASK_UNASSIGNED',
  'TASK_REASSIGNED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'PROGRESS_CHANGED',
  'DUE_DATE_CHANGED',
  'TASK_COMPLETED',
  'COMMENT_ADDED',
  'ATTACHMENT_UPLOADED',
  'PROJECT_CREATED',
  'PROJECT_UPDATED',
  'PROJECT_STATUS_CHANGED'
);

create type public.notification_type as enum (
  'TASK_ASSIGNED',
  'TASK_UNASSIGNED',
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'TASK_COMMENT',
  'TASK_STATUS_CHANGED',
  'TASK_COMPLETED',
  'PROJECT_UPDATED',
  'MENTION',
  'SYSTEM'
);

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  avatar_url  text,
  role        public.user_role not null default 'INDIVIDUAL',
  department  text,
  job_title   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'Application profile for each auth user. role is global; data access is additionally scoped by workspace membership.';

-- -----------------------------------------------------------------------------
-- workspaces
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 200),
  description text,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- workspace_members (many-to-many: a user may belong to several workspaces)
-- -----------------------------------------------------------------------------
create table public.workspace_members (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  -- Per-workspace permission: lets an ADMIN create projects ("create projects if permitted").
  can_create_projects boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint workspace_members_workspace_user_key unique (workspace_id, user_id)
);

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 200),
  description  text,
  client_name  text,
  status       public.project_status not null default 'PLANNING',
  priority     public.priority_level not null default 'MEDIUM',
  start_date   date,
  due_date     date,
  owner_id     uuid references public.profiles (id) on delete set null,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint projects_dates_check check (due_date is null or start_date is null or due_date >= start_date)
);

-- -----------------------------------------------------------------------------
-- tasks (single self-referencing table: tasks and subtasks are the same entity)
-- -----------------------------------------------------------------------------
create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  -- Denormalised from projects.workspace_id (maintained by trigger) so RLS and
  -- workspace-wide dashboards can filter tasks without joining projects.
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  parent_task_id  uuid references public.tasks (id) on delete cascade,
  title           text not null check (char_length(trim(title)) between 1 and 500),
  description     text,
  status          public.task_status not null default 'TODO',
  priority        public.priority_level not null default 'MEDIUM',
  task_type       public.task_type not null default 'TASK',
  start_date      date,
  due_date        date,
  estimated_hours numeric(8, 2) check (estimated_hours is null or estimated_hours >= 0),
  -- Kept in sync with time_entries by trigger.
  actual_hours    numeric(8, 2) not null default 0 check (actual_hours >= 0),
  progress        smallint not null default 0 check (progress between 0 and 100),
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint tasks_not_own_parent check (parent_task_id is null or parent_task_id <> id),
  constraint tasks_dates_check check (due_date is null or start_date is null or due_date >= start_date)
);

comment on column public.tasks.parent_task_id is 'Self reference for unlimited nesting. Must be in the same project; cycles are rejected by trigger.';

-- -----------------------------------------------------------------------------
-- task_assignees (multiple assignees, at most one primary)
-- -----------------------------------------------------------------------------
create table public.task_assignees (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid default auth.uid() references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  is_primary  boolean not null default false,
  constraint task_assignees_task_user_key unique (task_id, user_id)
);

-- -----------------------------------------------------------------------------
-- task_dependencies
-- -----------------------------------------------------------------------------
create table public.task_dependencies (
  id                 uuid primary key default gen_random_uuid(),
  task_id            uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  dependency_type    public.dependency_type not null default 'FINISH_TO_START',
  created_at         timestamptz not null default now(),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id),
  constraint task_dependencies_pair_key unique (task_id, depends_on_task_id)
);

-- -----------------------------------------------------------------------------
-- task_comments
-- -----------------------------------------------------------------------------
create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  user_id    uuid default auth.uid() references public.profiles (id) on delete set null,
  comment    text not null check (char_length(trim(comment)) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- task_attachments (metadata; binary lives in Supabase Storage)
-- -----------------------------------------------------------------------------
create table public.task_attachments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  uploaded_by uuid default auth.uid() references public.profiles (id) on delete set null,
  file_name   text not null check (char_length(file_name) between 1 and 500),
  file_url    text not null,
  file_type   text,
  file_size   bigint check (file_size is null or file_size >= 0),
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- activity_logs (append-only; written by triggers / server code)
-- -----------------------------------------------------------------------------
create table public.activity_logs (
  id           uuid primary key default gen_random_uuid(),
  -- Every event is workspace-scoped; used for RLS and the company-wide feed.
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null,
  task_id      uuid references public.tasks (id) on delete set null,
  project_id   uuid references public.projects (id) on delete set null,
  action       public.activity_action not null,
  old_value    jsonb,
  new_value    jsonb,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  type       public.notification_type not null,
  title      text not null,
  message    text,
  task_id    uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  is_read    boolean not null default false,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

-- -----------------------------------------------------------------------------
-- time_entries
-- -----------------------------------------------------------------------------
create table public.time_entries (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.tasks (id) on delete cascade,
  user_id          uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,                 -- null = timer running
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0), -- derived by trigger
  description      text,
  created_at       timestamptz not null default now(),
  constraint time_entries_range_check check (ended_at is null or ended_at >= started_at)
);

-- -----------------------------------------------------------------------------
-- daily_reports (one per user per workspace per day)
-- -----------------------------------------------------------------------------
create table public.daily_reports (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  workspace_id      uuid not null references public.workspaces (id) on delete cascade,
  report_date       date not null default current_date,
  tasks_completed   integer not null default 0 check (tasks_completed >= 0),
  tasks_in_progress integer not null default 0 check (tasks_in_progress >= 0),
  tasks_blocked     integer not null default 0 check (tasks_blocked >= 0),
  total_hours       numeric(5, 2) not null default 0 check (total_hours between 0 and 24),
  accomplishments   text,
  blockers          text,
  tomorrow_plan     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint daily_reports_user_workspace_date_key unique (user_id, workspace_id, report_date)
);
