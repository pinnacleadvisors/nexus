-- 042_coolify_audit — audit log + kill switch for the Coolify MCP.
--
-- Two tables:
--   1. coolify_audit_log    — append-only record of every Coolify API call
--                              the agent makes through the MCP. Reads + writes
--                              both logged. Powers the /settings/accounts
--                              activity feed + suspicious-action heuristics.
--   2. coolify_kill_switch  — single-row table. When status='revoked' the MCP
--                              refuses all calls. Operator flips this from
--                              /settings/accounts → Coolify → Disconnect.
--
-- Why a table (not just env var or connected_accounts):
--   - The mcp-coolify server reads it on every tool call (≤2s polling).
--     A Doppler env change would need a gateway redeploy to propagate.
--   - The audit feed needs a query surface and pgvector-style filtering;
--     env vars don't give us that.
--   - connected_accounts is OAuth-scoped (per business_slug + user). Coolify
--     is a single platform-wide resource. Cleaner to keep it standalone.

create extension if not exists "uuid-ossp";

-- ── coolify_audit_log ────────────────────────────────────────────────────────
create table if not exists public.coolify_audit_log (
  id            uuid          primary key default uuid_generate_v4(),
  -- Operator whose chat turn invoked the tool. Always the platform operator.
  user_id       text          not null,
  -- Gateway job_id from /api/jobs. Same correlation key the permission-broker
  -- uses (PR #189). Lets the chat UI link an audit row back to a specific turn.
  job_id        text,
  -- MCP tool name, e.g. 'coolify_list_apps', 'coolify_redeploy'.
  action        text          not null,
  -- Target uuid (app, service, database). Null for list / non-targeted ops.
  target_uuid   text,
  -- Tool input args, with secret values REDACTED by the MCP before insert.
  -- For coolify_set_env, the `value` field is replaced with '***'.
  args_redacted jsonb         not null default '{}'::jsonb,
  -- 'success', 'error', 'rate_limited', 'protected_uuid', 'kill_switch'
  result        text          not null,
  -- Error message when result != 'success'. Truncated to 1000 chars.
  error_message text,
  -- Duration of the underlying Coolify API call in ms (null when refused
  -- before the call fired).
  duration_ms   integer,
  created_at    timestamptz   not null default now(),

  constraint coolify_audit_log_result_check
    check (result in ('success', 'error', 'rate_limited', 'protected_uuid', 'kill_switch'))
);

create index if not exists coolify_audit_log_user_idx
  on public.coolify_audit_log (user_id, created_at desc);

create index if not exists coolify_audit_log_action_idx
  on public.coolify_audit_log (action, created_at desc);

-- For the rate-limit query (recent rows in this user's window).
create index if not exists coolify_audit_log_recent_writes_idx
  on public.coolify_audit_log (user_id, created_at desc)
  where result = 'success' and action not like 'coolify_list%' and action not like 'coolify_get%';

alter table public.coolify_audit_log enable row level security;

drop policy if exists coolify_audit_log_service_all on public.coolify_audit_log;
create policy coolify_audit_log_service_all on public.coolify_audit_log
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- ── coolify_kill_switch ──────────────────────────────────────────────────────
-- Single-row table. Seeded with one row at migration time so the MCP can
-- always find it. Operator UPDATEs the row to flip status.
create table if not exists public.coolify_kill_switch (
  -- Hard-coded singleton key — only one row ever exists.
  singleton    boolean       primary key default true,
  status       text          not null default 'active',
  -- Optional human-readable reason set when status='revoked'.
  revoked_by   text,
  revoked_at   timestamptz,
  revoked_reason text,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),

  constraint coolify_kill_switch_status_check
    check (status in ('active', 'revoked')),
  constraint coolify_kill_switch_singleton_check
    check (singleton = true)
);

-- Seed the row. ON CONFLICT keeps the existing status on re-run.
insert into public.coolify_kill_switch (singleton, status)
values (true, 'active')
on conflict (singleton) do nothing;

alter table public.coolify_kill_switch enable row level security;

drop policy if exists coolify_kill_switch_service_all on public.coolify_kill_switch;
create policy coolify_kill_switch_service_all on public.coolify_kill_switch
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
