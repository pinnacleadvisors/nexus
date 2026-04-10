-- Migration: 002_tasks_and_projects
-- Description: Kanban tasks table + projects table with Supabase Realtime
-- Applied by: npm run migrate

-- ── Projects (business workspaces) ───────────────────────────────────────────
-- Mirrors the ForgeProject entries stored in localStorage.
-- project_id on tasks links board cards to a specific business/project.
CREATE TABLE IF NOT EXISTS projects (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Tasks (Kanban board cards) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID        REFERENCES projects(id) ON DELETE SET NULL,
  title         TEXT        NOT NULL,
  description   TEXT        NOT NULL DEFAULT '',
  column_id     TEXT        NOT NULL DEFAULT 'backlog'
                            CHECK (column_id IN ('backlog', 'in-progress', 'review', 'completed')),
  assignee      TEXT,
  priority      TEXT        NOT NULL DEFAULT 'medium'
                            CHECK (priority IN ('low', 'medium', 'high')),
  asset_url     TEXT,
  revision_note TEXT,
  -- milestone_id links back to a Forge milestone so Approve can dispatch the next one
  milestone_id  TEXT,
  -- position within column for stable ordering
  position      INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_project_id ON tasks (project_id);
CREATE INDEX IF NOT EXISTS tasks_column_id  ON tasks (column_id);
CREATE INDEX IF NOT EXISTS tasks_position   ON tasks (position);

-- ── Realtime ──────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;

-- ── Auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_set_updated_at ON tasks;
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
