-- Migration: 016_plan_patterns
-- Description: Goal-level decomposition patterns. Feeds ReasoningBank.findSimilarPlans
--              so strategicDecompose can show the top-1 prior plan as a few-shot
--              example, biasing the Queen toward decompositions that already
--              worked.
--
--              Written at the end of a successful run (via controller.advancePhase
--              to 'done') so only shipped plans influence future ones.

-- Enable trigram extension for similarity search. Safe to run repeatedly.
-- Must come before the gin_trgm_ops index below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS plan_patterns (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID        REFERENCES runs(id) ON DELETE SET NULL,
  user_id        TEXT        NOT NULL,
  goal           TEXT        NOT NULL,
  goal_keywords  TEXT        NOT NULL,                  -- lowercased, stop-words removed, space-separated
  plan           JSONB       NOT NULL,                  -- SwarmPlan shape
  phase_count    INT         NOT NULL DEFAULT 0,
  task_count     INT         NOT NULL DEFAULT 0,
  outcome_score  NUMERIC(4,2) NOT NULL DEFAULT 0.5,     -- 0..1, derived from review_rejects + metrics
  token_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plan_patterns_user_created
  ON plan_patterns (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS plan_patterns_goal_keywords_trgm
  ON plan_patterns USING GIN (goal_keywords gin_trgm_ops);

ALTER TABLE plan_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_patterns_own" ON plan_patterns;
CREATE POLICY "plan_patterns_own" ON plan_patterns
  FOR ALL
  USING (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'));
