-- Migration: 012_task_types_and_dependencies
-- Description: Adds task_type (manual/automated) and depends_on (task dependencies)
-- so the Kanban board can filter between automated and manual work, and rank
-- manual tasks by how many automated tasks are blocked on them.
--
-- Two-way sync with n8n: n8n writes to this same `tasks` table via the
-- Supabase REST API (using SUPABASE_SERVICE_ROLE_KEY) or via the
-- /api/webhooks/n8n endpoint. Either direction updates the board in realtime.

-- ── Columns ──────────────────────────────────────────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'automated'
    CHECK (task_type IN ('manual', 'automated'));

-- depends_on stores the IDs of tasks that must finish before this one starts.
-- Kept as UUID[] so a single GIN index can answer "which tasks depend on X?".
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS depends_on UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS tasks_task_type   ON tasks (task_type);
CREATE INDEX IF NOT EXISTS tasks_depends_on  ON tasks USING GIN (depends_on);

-- ── Record migration ─────────────────────────────────────────────────────────
INSERT INTO schema_migrations (filename) VALUES ('012_task_types_and_dependencies.sql')
  ON CONFLICT DO NOTHING;
