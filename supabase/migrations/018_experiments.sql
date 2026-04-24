-- Migration: 018_experiments
-- Description: C5 — A/B experiment harness. Each experiment ties a run to two
--              content variants (variant_a, variant_b), tracks sample sizes +
--              outcome scores as they come in from the measure phase, and
--              locks in a winner once the z-test hits 95% confidence.
--              The loser auto-files a workflow_feedback row so the optimiser
--              can revise the producing agent.

CREATE TABLE IF NOT EXISTS experiments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID        REFERENCES runs(id) ON DELETE CASCADE,
  user_id        TEXT        NOT NULL,
  hypothesis     TEXT,
  variant_a      JSONB       NOT NULL,                 -- { id, label, content, agentSlug? }
  variant_b      JSONB       NOT NULL,
  samples_a      INT         NOT NULL DEFAULT 0,
  samples_b      INT         NOT NULL DEFAULT 0,
  successes_a    INT         NOT NULL DEFAULT 0,
  successes_b    INT         NOT NULL DEFAULT 0,
  winner         TEXT        CHECK (winner IN ('a','b','tie') OR winner IS NULL),
  confidence     NUMERIC(5,4),                         -- 0.0 .. 1.0 from z-test
  status         TEXT        NOT NULL DEFAULT 'running'
                             CHECK (status IN ('running','decided','stopped')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS experiments_user_created
  ON experiments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS experiments_run
  ON experiments (run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS experiments_status
  ON experiments (user_id, status)
  WHERE status = 'running';

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "experiments_own" ON experiments;
CREATE POLICY "experiments_own" ON experiments
  FOR ALL
  USING (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'));
