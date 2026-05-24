-- 056_operator_notes — per-scope markdown scratchpad for the Notes view.
--
-- Phase V1 of task_plan-chat-views.md (also Block B of task_plan-this-week.md).
-- The Notes panel in the Views dropdown opens a single markdown blob per
-- (user_id, scope) — NOT per session. Same scope can be opened in multiple
-- chat tabs; they share one set of notes. Concurrent edits use last-write-
-- wins with a soft conflict warning: a row's `updated_at` mismatch on PUT
-- triggers a "your version is stale, reload?" banner in the UI (no merge
-- UI, just discard or overwrite).
--
-- Why one blob per scope, not per session:
--   - Notes are the operator's scratch context for the BUSINESS (or admin
--     surface), not for a particular conversation. New chat session = same
--     notes still apply.
--   - Avoids forking memory when the operator deletes a session — notes
--     survive.
--
-- Scope partitioning matches chat_sessions / background_tasks:
--   - 'admin'           — platform copilot at /manage-platform/chat
--   - 'business:<slug>' — per-business copilot at /businesses/<slug>/chat
--
-- RLS: service-role-only. The /api/views/notes route gates by Clerk auth()
-- + ALLOWED_USER_IDS before any DB call, mirroring chat_sessions.

create extension if not exists "uuid-ossp";

create table if not exists public.operator_notes (
  id          uuid          primary key default uuid_generate_v4(),
  user_id     text          not null,
  scope       text          not null,
  body        text          not null default '',
  updated_at  timestamptz   not null default now(),

  -- Exactly one notes blob per (user, scope). The PUT route is upsert-by-
  -- this-constraint so a fresh scope creates a row on first save.
  constraint operator_notes_scope_unique unique (user_id, scope),

  -- Scope-format guard. Keeps stray values from polluting the table.
  constraint operator_notes_scope_check
    check (scope = 'admin' or scope like 'business:%')
);

-- Lookup by (user, scope) is the only read pattern; the unique index above
-- already covers it. No additional indexes needed at v1 volume.

alter table public.operator_notes enable row level security;

-- Service-role only. API routes run server-side with service-role key.
drop policy if exists operator_notes_service_role on public.operator_notes;
create policy operator_notes_service_role on public.operator_notes
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
