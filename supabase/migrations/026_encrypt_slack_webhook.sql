-- Migration: 026_encrypt_slack_webhook
-- Description: Encrypt `business_operators.slack_webhook_url` at rest.
--
-- Problem: the URL is the only credential pinned to a Slack channel — anyone
--   with the URL can post into the owner's channel until it's rotated. Storing
--   it plaintext means a row leak (RLS bypass, backup exposure, third-party
--   replication) leaks the channel.
--
-- Strategy: app-side encryption via lib/crypto.ts (AES-256-GCM, ENCRYPTION_KEY
--   from Doppler).
--
--   - Add a new column `slack_webhook_url_enc TEXT` for the ciphertext.
--   - Read code prefers `_enc` (decrypt); falls back to `slack_webhook_url` so
--     pre-migration rows continue to work until the owner re-saves once.
--   - Write code always populates `_enc` and NULLs `slack_webhook_url`.
--
-- No backfill in SQL — encryption requires the application's ENCRYPTION_KEY
-- env var, which Postgres doesn't have access to. The single-owner re-saves
-- from the /settings/businesses UI; the new POST handler stamps the encrypted
-- column. See lib/business/db.ts for the read/write path.

ALTER TABLE business_operators
  ADD COLUMN IF NOT EXISTS slack_webhook_url_enc TEXT;

COMMENT ON COLUMN business_operators.slack_webhook_url IS
  'DEPRECATED — plaintext; will be cleared on next save. New writes go to slack_webhook_url_enc.';
COMMENT ON COLUMN business_operators.slack_webhook_url_enc IS
  'AES-256-GCM ciphertext (iv:tag:data hex) of the Slack incoming-webhook URL. Decrypt via lib/crypto.ts.';
