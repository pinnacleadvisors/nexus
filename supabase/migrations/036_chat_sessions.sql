-- 036_chat_sessions.sql
--
-- Persistent chat history for platform-copilot (Phase 4 of task_plan-chat.md).
-- Future per-business chats (Phase 5) reuse the same shape with
-- `scope='business:<slug>'`.
--
-- Two tables:
--   chat_sessions  — one row per conversation
--   chat_messages  — append-only message log per session
--
-- Idempotent. Re-running this migration on a DB that already has both
-- tables + their indexes + RLS policies is a no-op.

create table if not exists chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,                       -- Clerk user_id
  scope           text not null,                       -- 'platform' (today) | 'business:<slug>' (Phase 5)
  agent_slug      text not null default 'platform-copilot',
  title           text,                                 -- auto from first user message; nullable until first turn
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_id_last_msg_idx
  on chat_sessions(user_id, last_message_at desc);

create index if not exists chat_sessions_scope_idx
  on chat_sessions(scope);

create table if not exists chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references chat_sessions(id) on delete cascade,
  role        text not null check (role in ('user','assistant','system')),
  content     text not null,
  -- jsonb metadata: approval_id, tool_calls, durationMs, jobId, etc.
  -- Schema-on-read by design — different message kinds carry different shapes.
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_session_id_created_idx
  on chat_messages(session_id, created_at);

-- RLS — service-role only. The client never reads these tables directly;
-- all access flows through /api/platform-chat/* routes which authenticate
-- via Clerk and filter by user_id.
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

drop policy if exists "service role full access on chat_sessions" on chat_sessions;
create policy "service role full access on chat_sessions"
  on chat_sessions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full access on chat_messages" on chat_messages;
create policy "service role full access on chat_messages"
  on chat_messages for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

comment on table chat_sessions is
  'One row per chat conversation. Owned by user_id; scope is platform or business:<slug>. Phase 4 of task_plan-chat.md.';
comment on table chat_messages is
  'Append-only message log per chat session. role in (user|assistant|system); metadata jsonb holds approval_id, tool_calls, etc.';
comment on column chat_sessions.last_message_at is
  'Updated by app code on every message insert. Used for the sidebar sort order (most-recent first).';
