-- Migration: 017_metric_samples
-- Description: Per-agent / per-run observability samples for Pillar C. Every
--              swarm task emits input_tokens, output_tokens, cache_hit_ratio,
--              latency_ms, review_outcome so C2 (regression detector) and C6
--              (adaptive routing decay) have typed data to reason about.
--              Keyed by (agent_slug, kind, at) so the hot queries —
--              "last-24h vs last-7d p50/p95 per agent" — hit an index.

CREATE TABLE IF NOT EXISTS metric_samples (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID        REFERENCES runs(id) ON DELETE SET NULL,
  user_id     TEXT        NOT NULL,
  agent_slug  TEXT        NOT NULL,
  kind        TEXT        NOT NULL
                          CHECK (kind IN ('input_tokens','output_tokens','cache_hit_ratio','latency_ms','review_outcome','cost_usd')),
  value       DOUBLE PRECISION NOT NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS metric_samples_agent_kind_at
  ON metric_samples (agent_slug, kind, at DESC);

CREATE INDEX IF NOT EXISTS metric_samples_user_at
  ON metric_samples (user_id, at DESC);

CREATE INDEX IF NOT EXISTS metric_samples_run
  ON metric_samples (run_id)
  WHERE run_id IS NOT NULL;

ALTER TABLE metric_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "metric_samples_own" ON metric_samples;
CREATE POLICY "metric_samples_own" ON metric_samples
  FOR ALL
  USING (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'));

INSERT INTO schema_migrations (id, name)
VALUES (17, '017_metric_samples')
ON CONFLICT (id) DO NOTHING;
