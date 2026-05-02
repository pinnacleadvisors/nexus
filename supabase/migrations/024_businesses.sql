-- Migration: 024_businesses
-- Description: Phase A — autonomous business orchestration.
--   One row per business the operator runs. The Inngest cron at
--   inngest/functions/business-operator.ts iterates over
--   WHERE status='active' and dispatches the `business-operator` agent
--   for each, carrying the row (slug, money_model JSONB, kpi_targets JSONB,
--   etc.) as inputs.business so the agent can plan in context.
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

CREATE TABLE IF NOT EXISTS businesses (
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

CREATE INDEX IF NOT EXISTS businesses_user_status_idx ON businesses(user_id, status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION businesses_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS businesses_updated_at ON businesses;
CREATE TRIGGER businesses_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION businesses_set_updated_at();

-- RLS — owner-scoped. Service role (used by cron + dispatch routes) bypasses RLS.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS businesses_select_own ON businesses;
CREATE POLICY businesses_select_own ON businesses
  FOR SELECT USING (user_id = current_setting('request.jwt.claim.sub', true));

DROP POLICY IF EXISTS businesses_insert_own ON businesses;
CREATE POLICY businesses_insert_own ON businesses
  FOR INSERT WITH CHECK (user_id = current_setting('request.jwt.claim.sub', true));

DROP POLICY IF EXISTS businesses_update_own ON businesses;
CREATE POLICY businesses_update_own ON businesses
  FOR UPDATE USING (user_id = current_setting('request.jwt.claim.sub', true));

DROP POLICY IF EXISTS businesses_delete_own ON businesses;
CREATE POLICY businesses_delete_own ON businesses
  FOR DELETE USING (user_id = current_setting('request.jwt.claim.sub', true));
