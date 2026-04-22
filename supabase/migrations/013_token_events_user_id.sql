-- Migration: 013_token_events_user_id
-- Description: Attach user_id to token_events so the per-user daily cost cap
--              (lib/cost-guard.ts) can query spend without scanning the whole
--              table. Nullable for backward compat with historical rows that
--              predate the B9 cap — they simply do not count toward any user's
--              cap.

ALTER TABLE token_events
  ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS token_events_user_id_created_at
  ON token_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Record migration (follows the pattern from 001_initial_schema.sql)
INSERT INTO schema_migrations (id, name)
VALUES (13, '013_token_events_user_id')
ON CONFLICT (id) DO NOTHING;
