-- Migration: 025_tasks_lineage
-- Description: Adds explicit lineage columns to `tasks` so the orphan sweep can
--              deterministically detect Kanban cards whose parent idea / run
--              has been deleted. Before this migration `tasks` only had
--              `project_id` (a workspace pointer) and `milestone_id` (a string,
--              not a FK), so deleting an idea via DELETE /api/ideas left every
--              card it spawned dangling on the board with no way to detect it.
--
-- Strategy:
--   - Three new columns, all nullable so existing rows are unaffected:
--       idea_id        UUID  → FK to ideas(id)        ON DELETE SET NULL
--       run_id         UUID  → FK to runs(id)         ON DELETE SET NULL
--       business_slug  TEXT  → loose link to business_operators(slug)
--                              (kept TEXT not FK so legacy / archived business
--                              rows don't cascade-delete cards)
--   - Indexes on idea_id and run_id for the orphan-sweep query.
--   - No backfill — pre-existing rows stay NULL and the sweep treats them as
--     "legacy keep". New cards created by /api/agent, /api/runs, and the
--     n8n/claw webhook handlers will populate the lineage going forward.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS idea_id UUID
  REFERENCES ideas(id) ON DELETE SET NULL;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS run_id UUID
  REFERENCES runs(id) ON DELETE SET NULL;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS business_slug TEXT;

CREATE INDEX IF NOT EXISTS tasks_idea_id_idx
  ON tasks(idea_id) WHERE idea_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_run_id_idx
  ON tasks(run_id) WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tasks_business_slug_idx
  ON tasks(business_slug) WHERE business_slug IS NOT NULL;
