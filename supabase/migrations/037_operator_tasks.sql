-- 037_operator_tasks — manual to-do checklist for the chat Views feature.
--
-- The operator-views Views dropdown (added alongside this migration) opens
-- side panels that augment the chat — manual tasks, approval queue, calendar.
-- The Manual To-do panel reads/writes this table; the Approval queue + Calendar
-- panels derive from existing tables (chat_messages + run_events) and don't
-- need new storage.
--
-- Sources of task rows:
--   1. Operator-created — explicit "+ New task" click in the panel UI
--   2. Agent-created    — the assistant emits a `manual-task` fenced JSON
--                          block in its reply, parsed by the chat poll route
--                          and inserted with source='agent' + a back-link to
--                          the session that produced it.
--
-- Scope partitioning mirrors chat_sessions.scope — 'admin' for the platform
-- copilot, 'business:<slug>' for each per-business copilot. The agent is
-- responsible for emitting tasks under the right scope; the chat poll route
-- defends by overwriting the scope to the session's own scope (so a
-- malicious response can't write to another scope).
--
-- RLS: same single-user pattern as chat_sessions. Service-role has full
-- access; anon/authenticated keys can only read their own rows.

create extension if not exists "uuid-ossp";

create table if not exists public.operator_tasks (
  id                uuid          primary key default uuid_generate_v4(),
  user_id           text          not null,
  scope             text          not null,
  title             text          not null,
  description       text,
  done              boolean       not null default false,
  source            text          not null default 'operator',  -- 'operator' | 'agent'
  source_session_id uuid          references public.chat_sessions(id) on delete set null,
  due_at            timestamptz,
  created_at        timestamptz   not null default now(),
  completed_at      timestamptz,

  constraint operator_tasks_source_check check (source in ('operator', 'agent')),
  constraint operator_tasks_scope_check  check (
    scope = 'admin' or scope like 'business:%'
  )
);

create index if not exists operator_tasks_user_scope_done_idx
  on public.operator_tasks (user_id, scope, done, created_at desc);

create index if not exists operator_tasks_due_at_idx
  on public.operator_tasks (user_id, scope, due_at) where due_at is not null;

alter table public.operator_tasks enable row level security;

drop policy if exists operator_tasks_service_role_all on public.operator_tasks;
create policy operator_tasks_service_role_all
  on public.operator_tasks
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Anon/authenticated reads are disabled — every page goes through API routes
-- that auth with the Clerk session id and apply user-id filters server-side.
-- If we ever expose direct PostgREST reads, add a `user_id = auth.uid()`
-- policy. Until then, default deny is safer.
