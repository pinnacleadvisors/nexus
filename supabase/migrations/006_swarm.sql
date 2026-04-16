-- Phase 11: Multi-Agent Swarm Orchestration
-- Tables: swarm_runs, swarm_tasks, reasoning_patterns

CREATE TABLE IF NOT EXISTS swarm_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal          TEXT        NOT NULL,
  context       TEXT,
  queen_type    TEXT        NOT NULL DEFAULT 'strategic',
  consensus_type TEXT       NOT NULL DEFAULT 'raft',
  status        TEXT        NOT NULL DEFAULT 'pending',
  phases        JSONB       NOT NULL DEFAULT '[]',
  current_phase INT         NOT NULL DEFAULT 0,
  total_tokens  INT         NOT NULL DEFAULT 0,
  total_cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  budget_usd    DECIMAL(10,2),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  error         TEXT
);

CREATE TABLE IF NOT EXISTS swarm_tasks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  swarm_id    UUID        NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
  phase       INT         NOT NULL DEFAULT 0,
  title       TEXT        NOT NULL,
  description TEXT        NOT NULL,
  role        TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending',
  result      TEXT,
  votes       JSONB,
  tokens_used INT,
  model       TEXT,
  duration_ms INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reasoning_patterns (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type       TEXT        NOT NULL,
  task_hash       TEXT        NOT NULL,
  agent_role      TEXT        NOT NULL,
  model           TEXT        NOT NULL,
  prompt_hash     TEXT        NOT NULL,
  result_quality  DECIMAL(3,2) NOT NULL DEFAULT 0.5,
  tokens_used     INT         NOT NULL DEFAULT 0,
  duration_ms     INT         NOT NULL DEFAULT 0,
  approved        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS swarm_runs_status_idx        ON swarm_runs(status);
CREATE INDEX IF NOT EXISTS swarm_runs_created_at_idx    ON swarm_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS swarm_tasks_swarm_id_idx     ON swarm_tasks(swarm_id);
CREATE INDEX IF NOT EXISTS swarm_tasks_role_idx         ON swarm_tasks(role);
CREATE INDEX IF NOT EXISTS reasoning_task_type_idx      ON reasoning_patterns(task_type);
CREATE INDEX IF NOT EXISTS reasoning_task_hash_idx      ON reasoning_patterns(task_hash);
CREATE INDEX IF NOT EXISTS reasoning_agent_role_idx     ON reasoning_patterns(agent_role);
CREATE INDEX IF NOT EXISTS reasoning_approved_idx       ON reasoning_patterns(approved, result_quality DESC);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER swarm_runs_updated_at
  BEFORE UPDATE ON swarm_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER swarm_tasks_updated_at
  BEFORE UPDATE ON swarm_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Enable Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'swarm_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE swarm_runs;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'swarm_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE swarm_tasks;
  END IF;
END $$;
