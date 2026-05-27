-- 092 — chat session retrospectives (R9 of UX consult).
--
-- Add `retrospective_md` + `retrospective_generated_at` to chat_sessions.
-- A daily cron at /api/cron/chat-retrospectives picks sessions inactive
-- for ≥ 7 days AND missing a retrospective, generates a 1-paragraph
-- summary via getLlm(), persists it.
--
-- When the operator returns to the session 2 weeks later, the
-- retrospective renders at the top of the message history so they
-- immediately see "what we decided last time".
--
-- Idempotent (IF NOT EXISTS guards).

alter table chat_sessions
  add column if not exists retrospective_md text,
  add column if not exists retrospective_generated_at timestamptz;

create index if not exists chat_sessions_retrospective_pending_idx
  on chat_sessions (last_message_at)
  where retrospective_md is null;

comment on column chat_sessions.retrospective_md is
  '1-paragraph LLM-generated summary of what the session decided / '
  'discovered. Written by /api/cron/chat-retrospectives after 7d '
  'inactivity. Rendered at the top of the chat view when present. '
  'R9 of UX consult 2026-05-27.';
