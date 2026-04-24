-- Migration: 015_runs
-- Description: Persistent Run state machine. Ties an idea → spec → decompose →
--              build → review → launch → measure → optimise chain to a single
--              row so the ecosystem loop survives restarts and session boundaries.
--              `run_events` is an append-only log that every phase transition
--              and dispatch writes to for observability and replay.

CREATE TABLE IF NOT EXISTS runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL,
  idea_id      TEXT,
  project_id   TEXT,
  phase        TEXT        NOT NULL DEFAULT 'ideate'
                           CHECK (phase IN ('ideate','spec','decompose','build','review','launch','measure','optimise','done')),
  status       TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('pending','active','blocked','failed','done')),
  cursor       JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- phase-specific state (next step id, current agent slug, etc)
  metrics      JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- ctr, conversion, tokenCost, reviewRejects, latencyP50
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS runs_user_phase     ON runs (user_id, phase);
CREATE INDEX IF NOT EXISTS runs_user_updated   ON runs (user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS runs_user_idea_unique
  ON runs (user_id, idea_id)
  WHERE idea_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS run_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID        NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL,                     -- 'phase.advance', 'dispatch.completed', 'graph.retrieved', 'metric.sample'
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS run_events_run_created
  ON run_events (run_id, created_at);
CREATE INDEX IF NOT EXISTS run_events_kind_created
  ON run_events (kind, created_at DESC);

ALTER TABLE runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;

-- RLS matches the pattern from 004_rls_policies.sql — platform is single-owner so
-- the Clerk JWT 'sub' claim is trusted as user_id.
DROP POLICY IF EXISTS "runs_own" ON runs;
CREATE POLICY "runs_own" ON runs
  FOR ALL
  USING (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))
  WITH CHECK (user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub'));

DROP POLICY IF EXISTS "run_events_via_run" ON run_events;
CREATE POLICY "run_events_via_run" ON run_events
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM runs r
    WHERE r.id = run_events.run_id
      AND r.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM runs r
    WHERE r.id = run_events.run_id
      AND r.user_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
  ));
