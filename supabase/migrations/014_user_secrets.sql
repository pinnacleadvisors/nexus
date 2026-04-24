-- Migration: 014_user_secrets
-- Description: Per-user encrypted secret storage. Replaces cookie-based storage
--              of sensitive config (starting with OpenClaw gateway URL + bearer
--              token in /api/claw/config). All `value` columns are encrypted
--              client-side (Node) via lib/crypto.ts before insert, so even a
--              DB dump is not enough to recover secrets without ENCRYPTION_KEY.

CREATE TABLE IF NOT EXISTS user_secrets (
  user_id    TEXT        NOT NULL,
  kind       TEXT        NOT NULL,          -- e.g. 'openclaw', 'github_pat'
  name       TEXT        NOT NULL,          -- field name within `kind` (e.g. 'gatewayUrl', 'hookToken')
  value      TEXT        NOT NULL,          -- lib/crypto.ts ciphertext (iv:tag:data hex)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, kind, name)
);

CREATE INDEX IF NOT EXISTS user_secrets_user_id_kind
  ON user_secrets (user_id, kind);

ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;

-- Service-role writes only; anon key never touches this table.
DROP POLICY IF EXISTS "user_secrets_service_only" ON user_secrets;
CREATE POLICY "user_secrets_service_only" ON user_secrets
  FOR ALL USING (false) WITH CHECK (false);
