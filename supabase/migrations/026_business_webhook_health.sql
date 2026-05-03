-- Migration: 026_business_webhook_health
-- Description: Webhook health columns + encryption-at-rest for Slack webhook URL.
--
-- Adds three columns to business_operators:
--   webhook_last_verified_at  TIMESTAMPTZ — set on every successful verify
--   webhook_last_error        TEXT        — set on every failed verify
--                                          (cleared back to NULL on the next success)
--   slack_webhook_url_enc     TEXT        — AES-256-GCM ciphertext (lib/crypto.ts
--                                          encryptString() format), replaces the
--                                          plaintext slack_webhook_url column
--
-- Migration policy (Decision Q1 in task_plan-ux-security-onboarding.md):
--   The plaintext slack_webhook_url column stays around for one release as
--   a fallback. Application code (lib/business/db.ts) prefers _enc when set,
--   falls back to plaintext. A follow-up migration will drop the plaintext
--   column once we confirm every active row has been re-encrypted.
--
-- A separate one-shot script (scripts/migrate-encrypt-webhooks.ts) reads each
-- row's plaintext, encrypts to _enc, and clears the plaintext. The script is
-- the migration vehicle, not this SQL — encryption requires Node + crypto and
-- can't be done in pure pgsql without storing the key in the DB.

ALTER TABLE business_operators
  ADD COLUMN IF NOT EXISTS webhook_last_verified_at TIMESTAMPTZ;

ALTER TABLE business_operators
  ADD COLUMN IF NOT EXISTS webhook_last_error TEXT;

ALTER TABLE business_operators
  ADD COLUMN IF NOT EXISTS slack_webhook_url_enc TEXT;

CREATE INDEX IF NOT EXISTS business_operators_webhook_health_idx
  ON business_operators (webhook_last_verified_at)
  WHERE webhook_last_error IS NOT NULL;

-- Record migration
INSERT INTO schema_migrations (filename) VALUES ('026_business_webhook_health.sql')
  ON CONFLICT DO NOTHING;
