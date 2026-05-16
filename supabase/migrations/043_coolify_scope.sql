-- 043_coolify_scope — per-scope Coolify access for platform-copilot vs
-- business-copilot.
--
-- Two changes layered onto migration 042:
--   1. Add `scope` column to coolify_audit_log so the /settings/accounts
--      panel can filter the activity feed per scope ('admin' or
--      'business:<slug>'). Existing rows are backfilled to 'admin' because
--      pre-043 the MCP was admin-only.
--   2. Extend the result check to allow 'unauthorized_scope' — the MCP
--      logs this when a business-scoped agent tries to act on a uuid
--      that doesn't belong to its business.
--
-- Idempotent: re-runnable safely. ALTER TABLE adds the column only when
-- missing; CHECK constraint dropped + recreated.

-- ── add scope column ───────────────────────────────────────────────────────
alter table public.coolify_audit_log
  add column if not exists scope text not null default 'admin';

create index if not exists coolify_audit_log_scope_idx
  on public.coolify_audit_log (user_id, scope, created_at desc);

-- ── extend the result check ────────────────────────────────────────────────
-- Drop the prior constraint regardless of name to allow re-running on
-- DBs that already migrated this once.
alter table public.coolify_audit_log
  drop constraint if exists coolify_audit_log_result_check;

alter table public.coolify_audit_log
  add constraint coolify_audit_log_result_check
  check (result in ('success', 'error', 'rate_limited', 'protected_uuid', 'kill_switch', 'unauthorized_scope'));
