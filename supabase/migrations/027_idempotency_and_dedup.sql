-- Migration: 027_idempotency_and_dedup
-- Description: Two safety constraints surfaced by the 2026-05-03 retry-storm
--              audit (docs/RETRY_STORM_AUDIT.md):
--
--   1. `webhook_events` — generic idempotency table keyed by (source, event_id).
--      n8n's `executionId`, OpenClaw's `sessionId`, Stripe's `event.id`, etc.
--      all hash into the same table. Webhook handlers `INSERT ... ON CONFLICT
--      DO NOTHING` and check `inserted` to decide whether to process. Duplicate
--      deliveries become no-ops at the DB layer with no application logic.
--
--   2. `metric_samples` partial UNIQUE on `(run_id, agent_slug, kind)` where
--      `run_id IS NOT NULL`. Stops `recordSamples()` from inserting duplicate
--      observability rows when a cron re-fires after partial failure (audit
--      finding 6 / Tier 3 issue). Run-less ad-hoc samples stay untouched.

-- ── 1. webhook_events idempotency ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  source        TEXT        NOT NULL,    -- 'n8n', 'claw', 'stripe', 'slack', 'github'
  event_id      TEXT        NOT NULL,    -- upstream-provided unique ID
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata      JSONB,                   -- optional debug payload
  PRIMARY KEY (source, event_id)
);

-- Auto-purge old idempotency rows so the table stays small. Stripe events older
-- than 7 days won't be replayed in practice, n8n / claw far less. Run nightly.
CREATE OR REPLACE FUNCTION webhook_events_purge_older_than(days INT)
RETURNS INT AS $$
DECLARE
  removed INT;
BEGIN
  DELETE FROM webhook_events
   WHERE processed_at < NOW() - (days::TEXT || ' days')::INTERVAL;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Service-role only — webhook handlers run with service role, no RLS exposure.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "webhook_events_service_only" ON webhook_events;
CREATE POLICY "webhook_events_service_only" ON webhook_events
  FOR ALL USING (false);

-- ── 2. metric_samples dedup ────────────────────────────────────────────────────
-- Partial UNIQUE — only enforced when run_id is set. Ad-hoc samples (run_id NULL)
-- can still duplicate freely, which is the existing behaviour and not a known
-- problem. Keyed on (run_id, agent_slug, kind) because a single run shouldn't
-- emit the same metric twice for the same agent.
CREATE UNIQUE INDEX IF NOT EXISTS metric_samples_run_agent_kind_uniq
  ON metric_samples (run_id, agent_slug, kind)
  WHERE run_id IS NOT NULL;
