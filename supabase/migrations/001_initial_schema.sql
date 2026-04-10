-- Migration: 001_initial_schema
-- Description: Core tables — agents, revenue_events, token_events, alert_thresholds, schema_migrations
-- Applied by: npm run migrate

-- ── Migration tracking (created first so the runner can record this migration) ─
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT        PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Agents ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id              TEXT          PRIMARY KEY,
  name            TEXT          NOT NULL,
  status          TEXT          NOT NULL DEFAULT 'idle'
                                CHECK (status IN ('active', 'idle', 'error')),
  tasks_completed INTEGER       NOT NULL DEFAULT 0,
  tokens_used     BIGINT        NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12,4) NOT NULL DEFAULT 0,
  error_count     INTEGER       NOT NULL DEFAULT 0,
  last_active     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Enable realtime for the agents table
ALTER PUBLICATION supabase_realtime ADD TABLE agents;

-- ── Revenue events (Stripe webhook writes here) ───────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_events (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_usd  NUMERIC(12,2) NOT NULL,
  source      TEXT          NOT NULL DEFAULT 'stripe'
                            CHECK (source IN ('stripe', 'manual')),
  description TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS revenue_events_created_at ON revenue_events (created_at DESC);

-- ── Token events (per-API-call cost tracking) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS token_events (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      TEXT          REFERENCES agents(id) ON DELETE SET NULL,
  model         TEXT          NOT NULL,
  input_tokens  INTEGER       NOT NULL DEFAULT 0,
  output_tokens INTEGER       NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS token_events_agent_id   ON token_events (agent_id);
CREATE INDEX IF NOT EXISTS token_events_created_at ON token_events (created_at DESC);

-- ── Alert thresholds ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_thresholds (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  metric      TEXT          NOT NULL
                            CHECK (metric IN ('daily_cost', 'error_rate', 'agent_down')),
  threshold   NUMERIC(12,2) NOT NULL,
  channel     TEXT          NOT NULL DEFAULT 'email'
                            CHECK (channel IN ('email', 'slack')),
  destination TEXT          NOT NULL,
  enabled     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Helper function: roll up token costs onto the agent row ───────────────────
CREATE OR REPLACE FUNCTION increment_agent_cost(
  p_agent_id TEXT,
  p_tokens   BIGINT,
  p_cost     NUMERIC
) RETURNS VOID AS $$
  UPDATE agents
  SET
    tokens_used = tokens_used + p_tokens,
    cost_usd    = cost_usd    + p_cost,
    last_active = NOW()
  WHERE id = p_agent_id;
$$ LANGUAGE SQL;
