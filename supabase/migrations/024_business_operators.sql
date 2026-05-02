-- Migration: 024_business_operators
-- Description: Phase A — autonomous business orchestration.
--   One row per business the operator runs. The Inngest cron at
--   inngest/functions/business-operator.ts iterates over
--   WHERE status='active' and dispatches the `business-operator` agent
--   for each, carrying the row (slug, money_model JSONB, kpi_targets JSONB,
--   etc.) as inputs.business so the agent can plan in context.
--
-- Naming: `business_operators` (not `businesses`) because migration 003 already
--   created a `businesses` table for the legacy "business workspace" concept
--   used by lib/graph/builder.ts. This is the orchestrator-config table — same
--   per-business semantics, distinct schema.
--
-- Slack: each business pins ONE channel via slack_webhook_url. Inline
--   approve/reject buttons POST to /api/slack/decision which verifies the
--   signing secret and advances the linked Run.
--
-- Cost: lib/cost-guard.ts already enforces USER_BUSINESS_DAILY_USD_LIMIT
--   when the dispatch carries businessSlug. The operator MUST pass slug in
--   every gateway call so per-business spend is accounted for.
--
-- Seed rows are inserted via the Settings UI from `lib/business/seeds.ts`
--   (presets keep typed templates in code rather than embedding user-id
--   placeholders here).

CREATE TABLE IF NOT EXISTS business_operators (
  slug                    TEXT        PRIMARY KEY,
  name                    TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active','paused','archived')),
  user_id                 TEXT        NOT NULL,                    -- Clerk user id (owner)

  -- Brand
  brand_voice             TEXT,

  -- Schedule
  timezone                TEXT        NOT NULL DEFAULT 'Asia/Bangkok',
  daily_cron_local_hour   INT         NOT NULL DEFAULT 11,         -- in `timezone`

  -- Strategy
  niche                   TEXT        NOT NULL,
  money_model             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  kpi_targets             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  approval_gates          JSONB       NOT NULL DEFAULT '[]'::jsonb,  -- list of action prefixes that require human approval

  -- Slack
  slack_channel           TEXT,                                    -- e.g. '#nexus-ledger-lane' (display only)
  slack_webhook_url       TEXT,                                    -- incoming webhook pinned to that channel

  -- State
  current_run_id          UUID        REFERENCES runs(id) ON DELETE SET NULL,
  last_operator_at        TIMESTAMPTZ,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS business_operators_user_status_idx ON business_operators(user_id, status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION business_operators_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_operators_updated_at ON business_operators;
CREATE TRIGGER business_operators_updated_at
  BEFORE UPDATE ON business_operators
  FOR EACH ROW EXECUTE FUNCTION business_operators_set_updated_at();

-- RLS — owner-scoped. Service role (used by cron + dispatch routes) bypasses RLS.
ALTER TABLE business_operators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_operators_select_own ON business_operators;
CREATE POLICY business_operators_select_own ON business_operators
  FOR SELECT USING (user_id = current_setting('request.jwt.claim.sub', true));

DROP POLICY IF EXISTS business_operators_insert_own ON business_operators;
CREATE POLICY business_operators_insert_own ON business_operators
  FOR INSERT WITH CHECK (user_id = current_setting('request.jwt.claim.sub', true));

DROP POLICY IF EXISTS business_operators_update_own ON business_operators;
CREATE POLICY business_operators_update_own ON business_operators
  FOR UPDATE USING (user_id = current_setting('request.jwt.claim.sub', true));

DROP POLICY IF EXISTS business_operators_delete_own ON business_operators;
CREATE POLICY business_operators_delete_own ON business_operators
  FOR DELETE USING (user_id = current_setting('request.jwt.claim.sub', true));
