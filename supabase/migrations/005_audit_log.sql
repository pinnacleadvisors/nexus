-- Migration: 005_audit_log
-- Description: Audit log — every significant agent/user action recorded with actor + metadata
-- Applied by: npm run migrate

CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who performed the action (Clerk user ID; NULL for webhook/system events)
  user_id     TEXT,
  -- Short verb string: 'claw.dispatch', 'board.approve', 'oauth.connect', etc.
  action      TEXT        NOT NULL,
  -- Resource type: 'task', 'milestone', 'agent', 'oauth', 'skill', 'alert'
  resource    TEXT        NOT NULL,
  -- ID of the affected resource (task UUID, agent ID, provider name, …)
  resource_id TEXT,
  -- Free-form JSONB for additional context (project, title, IP, etc.)
  metadata    JSONB,
  -- Originating IP (hashed/truncated before storing — see lib/audit.ts)
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_user_id    ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS audit_log_action     ON audit_log (action);
CREATE INDEX IF NOT EXISTS audit_log_resource   ON audit_log (resource, resource_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at ON audit_log (created_at DESC);

-- No RLS needed — written only via service role key server-side
-- Reader access controlled by application layer
