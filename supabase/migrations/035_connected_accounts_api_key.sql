-- 035_connected_accounts_api_key.sql
--
-- Extend connected_accounts to support non-Composio platforms that authenticate
-- via a static API key (e.g. ConvertKit V4 keys, Cloudflare zone-scoped tokens).
-- The encrypted blob lives directly on the row — no Composio handle, no third-
-- party broker. Decryption uses the same ENCRYPTION_KEY (AES-256-GCM) as the
-- rest of the codebase via lib/crypto.ts.
--
-- See:
--   - app/api/connected-accounts/api-key/route.ts (POST + DELETE)
--   - lib/oauth/providers.ts (apiKeySetup field, ConvertKit + Cloudflare)
--   - app/api/businesses/[slug]/provision/route.ts (C4 — injects keys as env)
--
-- Idempotent: re-running this migration on a DB that already has the column +
-- relaxed nullability + check constraint is a no-op.
--
-- Storage shape: encrypted_api_key is bytea — we store the UTF-8 bytes of the
-- canonical "<iv>:<tag>:<ciphertext>" string produced by lib/crypto encrypt().
-- bytea (vs text) keeps psql/pg_dump from accidentally treating it as a string
-- column and lets a future migration switch to a binary AEAD format without
-- another type change.

-- 1. Add the encrypted blob column.
alter table connected_accounts
  add column if not exists encrypted_api_key bytea;

-- 2. Relax composio_account_id to allow NULL — required for API-key rows which
--    have no Composio handle. OAuth rows continue to populate it.
alter table connected_accounts
  alter column composio_account_id drop not null;

-- 3. Enforce: exactly one of composio_account_id / encrypted_api_key is set.
--    Use a named constraint so re-running the migration drops + re-adds cleanly
--    (Postgres does not have ADD CONSTRAINT IF NOT EXISTS for table checks).
alter table connected_accounts
  drop constraint if exists connected_accounts_credential_one_of;

alter table connected_accounts
  add constraint connected_accounts_credential_one_of
  check (
    (composio_account_id is not null and encrypted_api_key is null)
    or
    (composio_account_id is null     and encrypted_api_key is not null)
  );

comment on column connected_accounts.encrypted_api_key is
  'AES-256-GCM ciphertext (UTF-8 bytes of "<iv>:<tag>:<data>" hex string) for non-Composio API-key platforms. Decrypt with lib/crypto.decrypt(). Mutually exclusive with composio_account_id (see check constraint).';
comment on column connected_accounts.composio_account_id is
  'Composio''s connected_account_id for OAuth-brokered platforms. NULL for API-key platforms (see encrypted_api_key).';
