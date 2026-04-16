-- Migration: 003_businesses_milestones
-- Description: businesses table (per-user workspaces) + milestones table (Forge AI output)
-- Applied by: npm run migrate

-- ── Businesses ────────────────────────────────────────────────────────────────
-- One business = one idea/startup the owner is building.
-- user_id is the Clerk user ID — used for future RLS isolation.
CREATE TABLE IF NOT EXISTS businesses (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safety net: if the table was created by a prior partial run without user_id,
-- add the column now before the index tries to reference it.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS businesses_user_id ON businesses (user_id);

DROP TRIGGER IF EXISTS businesses_set_updated_at ON businesses;
CREATE TRIGGER businesses_set_updated_at
  BEFORE UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'businesses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE businesses;
  END IF;
END $$;

-- ── Milestones ────────────────────────────────────────────────────────────────
-- Milestones are extracted from Forge AI chat and stored per-project.
-- forge_id deduplicates across multiple AI extraction passes.
CREATE TABLE IF NOT EXISTS milestones (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        REFERENCES projects(id) ON DELETE CASCADE,
  forge_id    TEXT,
  title       TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  phase       INTEGER     NOT NULL DEFAULT 1,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'in-progress', 'done')),
  target_date TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS milestones_project_id ON milestones (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS milestones_forge_id ON milestones (project_id, forge_id)
  WHERE forge_id IS NOT NULL;

DROP TRIGGER IF EXISTS milestones_set_updated_at ON milestones;
CREATE TRIGGER milestones_set_updated_at
  BEFORE UPDATE ON milestones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'milestones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE milestones;
  END IF;
END $$;

-- ── Extend existing tables ────────────────────────────────────────────────────
-- Add user_id to projects so they can be filtered per-user in future RLS
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Add user_id to agents for future multi-tenant isolation
ALTER TABLE agents ADD COLUMN IF NOT EXISTS user_id TEXT;
