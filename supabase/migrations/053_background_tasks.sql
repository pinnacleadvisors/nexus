-- 053_background_tasks — agent-spawned long-running work surface.
--
-- Phase 4 of task_plan-collaborative-chat.md. When the chat agent identifies
-- work that's too long to fit one turn (Playwright runs, Firecrawl crawls,
-- multi-step codex dispatches), it emits a `background-task` block that
-- creates a row here. The Background tasks view in the Views dropdown
-- (added alongside this migration) polls + renders status.
--
-- v1 scope: row exists, agent + operator both see it, status moves
-- pending → running → done/error/cancelled via API calls. v2 (separate PR)
-- will wire Inngest handlers so the row's `kind` actually dispatches the
-- referenced job. v1 = the visible surface; v2 = autonomous execution.
--
-- Scope partitioning mirrors chat_sessions: 'admin' for platform copilot,
-- 'business:<slug>' for per-business copilots. RLS service-role-only.

create extension if not exists "uuid-ossp";

create table if not exists public.background_tasks (
  id                uuid          primary key default uuid_generate_v4(),
  user_id           text          not null,
  scope             text          not null,
  -- Back-link to the chat session that spawned this — survives session
  -- deletion via set null so we don't cascade-delete history.
  chat_session_id   uuid          references public.chat_sessions(id) on delete set null,

  -- What the agent wants to do. `kind` is a tag for the dispatcher
  -- (v2 Inngest wiring). v1 = informational, the dispatcher is unimplemented.
  -- Free-form so we can add new kinds without a migration.
  --   'playwright-run' — Playwright smoke against a URL
  --   'firecrawl-crawl' — Firecrawl crawl of N pages
  --   'codex-dispatch' — codex-operator delegation
  --   'n8n-workflow' — n8n workflow trigger
  --   'custom' — anything else (description carries the prose)
  kind              text          not null,
  title             text          not null,
  description       text,
  payload           jsonb         not null default '{}'::jsonb,

  status            text          not null default 'pending',
  -- pending → running → done | error | cancelled
  -- v1 transitions: API routes set running/done/error; cancel route sets cancelled.
  -- v2: Inngest handler bumps running → done|error automatically.

  result            jsonb,        -- structured success output (kind-specific)
  error             text,         -- short error message when status='error'

  started_at        timestamptz,
  finished_at       timestamptz,
  cancelled_at      timestamptz,
  created_at        timestamptz   not null default now(),

  constraint background_tasks_status_check check (status in ('pending', 'running', 'done', 'error', 'cancelled'))
);

create index if not exists background_tasks_user_scope_status_idx
  on public.background_tasks (user_id, scope, status, created_at desc);

create index if not exists background_tasks_session_idx
  on public.background_tasks (chat_session_id)
  where chat_session_id is not null;

-- RLS — single-user pattern. Service-role gets full access for the API
-- routes (Clerk-auth'd); anon/authenticated readers can only see their own.
alter table public.background_tasks enable row level security;

drop policy if exists "background_tasks_owner_select" on public.background_tasks;
create policy "background_tasks_owner_select" on public.background_tasks
  for select using (auth.uid()::text = user_id);

drop policy if exists "background_tasks_owner_modify" on public.background_tasks;
create policy "background_tasks_owner_modify" on public.background_tasks
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
