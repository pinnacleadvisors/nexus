-- 041_chat_permission_requests — Claude-Code-Desktop-style Allow buttons.
--
-- When the claude-gateway CLI hits a tool call that isn't pre-approved,
-- the mcp-permission-broker tool (services/mcp-permission-broker/) catches
-- it via `--permission-prompt-tool`. The broker writes a row HERE with
-- status='pending', then polls this same row every ~1s until the operator
-- decides via POST /api/platform-chat/permission-requests/:id/decide.
--
-- The chat poll route surfaces pending rows in its response so the chat
-- UI renders a PermissionPromptCard with Allow / Deny / Edit-input
-- buttons (mirrors `approval-request` but driven by the CLI's own
-- permission system instead of the agent's prose).
--
-- Idempotent: only the broker inserts. The decide route updates exactly
-- one row by id (with user_id check). RLS allows service-role only.

create extension if not exists "uuid-ossp";

create table if not exists public.chat_permission_requests (
  id            uuid          primary key default uuid_generate_v4(),
  user_id       text          not null,
  -- Gateway job_id from /api/jobs. Links a permission request to the
  -- in-flight chat turn so the poll route can surface it under the
  -- right session.
  job_id        text          not null,
  -- Tool the CLI is trying to call (e.g. 'Bash', 'Edit',
  -- 'mcp__composio-admin__admin_execute_action').
  tool_name     text          not null,
  -- The tool's input arguments, JSON-encoded. UI displays this for the
  -- operator's review. The /decide route may PATCH it via
  -- decision.updated_input — the MCP returns that as `updatedInput` so
  -- the CLI uses the operator's amended args.
  tool_input    jsonb         not null default '{}'::jsonb,
  -- Stable id from the CLI's tool_use event — lets the broker match
  -- multiple in-flight requests in the same job.
  tool_use_id   text,
  status        text          not null default 'pending',
  -- When status flips to 'allowed' or 'denied', the operator's decision
  -- lands here: { reason?: string, updated_input?: jsonb,
  -- remember_for_session?: boolean }.
  decision      jsonb,
  created_at    timestamptz   not null default now(),
  resolved_at   timestamptz,

  constraint chat_permission_requests_status_check
    check (status in ('pending', 'allowed', 'denied', 'expired'))
);

create index if not exists chat_permission_requests_pending_idx
  on public.chat_permission_requests (user_id, job_id, status)
  where status = 'pending';

create index if not exists chat_permission_requests_job_idx
  on public.chat_permission_requests (job_id, created_at desc);

alter table public.chat_permission_requests enable row level security;

-- Service-role only — same model as chat_messages.
drop policy if exists chat_permission_requests_service_all on public.chat_permission_requests;
create policy chat_permission_requests_service_all on public.chat_permission_requests
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
