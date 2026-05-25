-- 058_tool_call_audit.sql
--
-- Append-only audit log for every MCP tool invocation across every agent
-- gateway. Distinct from the existing 005_audit_log (which captures
-- application-level actions like "user connected an account"); this table
-- captures the finer-grain "agent X called MCP tool Y with redacted args Z"
-- so the operator can audit any decision an agent made.
--
-- Used by:
--   * services/mcp-composio-admin/*    (Composio admin-scope actions)
--   * services/mcp-doppler-admin/*     (NEW — Doppler reads / proposed writes)
--   * services/mcp-supabase-admin/*    (NEW — Supabase reads / proposed writes)
--   * services/mcp-coolify/*           (existing coolify_audit_log was the model)
--   * services/mcp-codex-delegate/*    (delegations to codex-operator)
--   * services/mcp-permission-broker/* (operator-approved fallback calls)
--
-- Append-only invariant — there is intentionally NO update/delete policy.
-- Rows live forever (or until pruned by a separate retention job).
-- Reads gated to owner via app layer (api route checks ALLOWED_USER_IDS).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; CREATE INDEX IF NOT EXISTS;
-- DROP POLICY IF EXISTS / CREATE POLICY.
--
-- Paired helper: lib/audit/tool-call.ts (recordToolCall + redaction).
-- See: task_plan-platform-expansion.md (Task E)
--      AGENTS.md "Operating principles" — full audit trail clause.

create table if not exists tool_call_audit (
  id                uuid          primary key default gen_random_uuid(),
  ts                timestamptz   not null default now(),

  -- Who: which agent / gateway / scope
  agent_slug        text          null,   -- e.g. 'platform-copilot', 'business-copilot', 'codex-operator'
  scope             text          null,   -- 'admin' | 'business:<slug>' | 'shared'
  user_id           text          null,   -- Clerk userId of the operator running the session (when known)

  -- What: which MCP server + tool
  mcp_server        text          not null, -- 'composio-admin', 'doppler-admin', 'supabase-admin', 'coolify', 'codex-delegate', 'permission-broker'
  tool_name         text          not null, -- e.g. 'admin_execute_action', 'doppler_get_secret', 'supabase_select'

  -- Payload (REDACTED — secrets stripped client-side by lib/audit/tool-call.ts).
  -- Never store raw token / key / secret values here.
  args_redacted     jsonb         null,
  result_status     text          null,   -- 'ok' | 'error' | 'requires_approval' | 'denied' | 'rate_limited' | 'kill_switch'
  result_excerpt    text          null,   -- first 2KB of result.body / stringified — truncated by helper

  -- Ancestry — soft references (not FKs; mirrors run_events_ancestry semantics)
  business_slug     text          null,
  run_id            uuid          null,
  issue_id          uuid          null,
  goal_id           uuid          null,

  -- Bookkeeping
  approval_id       text          null,   -- when the call was gated by an approval-request, record which one
  latency_ms        integer       null
);

create index if not exists tool_call_audit_ts_idx
  on tool_call_audit(ts desc);
create index if not exists tool_call_audit_agent_idx
  on tool_call_audit(agent_slug, ts desc)
  where agent_slug is not null;
create index if not exists tool_call_audit_mcp_tool_idx
  on tool_call_audit(mcp_server, tool_name, ts desc);
create index if not exists tool_call_audit_business_idx
  on tool_call_audit(business_slug, ts desc)
  where business_slug is not null;
create index if not exists tool_call_audit_issue_idx
  on tool_call_audit(issue_id, ts desc)
  where issue_id is not null;

alter table tool_call_audit enable row level security;

-- Service-role-only writes. No UPDATE/DELETE policy means the table is
-- effectively append-only for non-superuser callers.
drop policy if exists tool_call_audit_service_role_insert on tool_call_audit;
create policy tool_call_audit_service_role_insert on tool_call_audit
  for insert with check (true);

drop policy if exists tool_call_audit_service_role_select on tool_call_audit;
create policy tool_call_audit_service_role_select on tool_call_audit
  for select using (true);

comment on table tool_call_audit is
  'Append-only audit of every MCP tool invocation. Distinct from 005 audit_log (app-level actions). Reads gated to owner at app layer; writes via service-role from MCP wrappers. See task_plan-platform-expansion.md Task E.';
comment on column tool_call_audit.args_redacted is
  'JSONB of tool args with any matching /token|key|secret|password/i field redacted to "***". lib/audit/tool-call.ts owns the redaction logic.';
comment on column tool_call_audit.result_excerpt is
  'First 2KB of the stringified result. Long responses are truncated; consult the agent transcript for the full payload.';
comment on column tool_call_audit.result_status is
  'ok | error | requires_approval | denied | rate_limited | kill_switch. Drives the dashboard heatmap.';
