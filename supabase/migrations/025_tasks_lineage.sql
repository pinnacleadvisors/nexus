-- Migration: 025_tasks_lineage
-- Description: Lineage columns + soft-archive on the tasks table so that
--   (a) deleting an idea cascades to NULL on the dependent task rows
--       (so the orphan sweeper can detect them deterministically), and
--   (b) the board can hide soft-archived rows without deleting history.
--
-- Why now: tasks created before this migration only know their project_id.
--   When a user deletes an idea, the cards it spawned never disappear from
--   the Board. Adding idea_id + run_id + business_slug + archived_at gives
--   the orphan sweeper (PR 3 of task_plan-ux-security-onboarding.md) a
--   deterministic signal to act on, and gives a 7-day grace before any
--   row is hard-deleted.
--
-- Backfill policy: leave existing rows NULL. The sweeper treats >30-day
--   nulls as legacy candidates. The one-shot purge script handles the
--   current Board flood. Decision Q2 in the plan.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS idea_id UUID
    REFERENCES ideas(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS run_id UUID
    REFERENCES runs(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS business_slug TEXT;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial indexes — keep them tight so the catalog doesn't bloat for the
-- common case where most rows have NULL lineage (legacy) or no archive.
CREATE INDEX IF NOT EXISTS tasks_idea_id_idx
  ON tasks (idea_id)
  WHERE idea_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_run_id_idx
  ON tasks (run_id)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_business_slug_idx
  ON tasks (business_slug)
  WHERE business_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_archived_at_idx
  ON tasks (archived_at)
  WHERE archived_at IS NOT NULL;

-- Record migration
INSERT INTO schema_migrations (filename) VALUES ('025_tasks_lineage.sql')
  ON CONFLICT DO NOTHING;
