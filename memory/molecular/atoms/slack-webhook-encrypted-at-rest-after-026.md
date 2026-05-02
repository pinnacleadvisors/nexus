---
type: atom
title: "Slack webhook URLs encrypted at rest after migration 026"
id: slack-webhook-encrypted-at-rest-after-026
created: 2026-05-03
sources:
  - file://supabase/migrations/026_encrypt_slack_webhook.sql
  - file://lib/business/db.ts
  - file://lib/crypto.ts
links:
  - "[[business-operators-table-rename]]"
status: active
lastAccessed: 2026-05-03
accessCount: 0
---

# Slack webhook URLs encrypted at rest after migration 026

Before migration 026, `business_operators.slack_webhook_url` was stored plaintext. A row leak (RLS bypass, backup exposure, third-party replication) would have exposed the channel-pinned credential, since anyone with the URL can post into that Slack channel until rotated.

Migration 026 adds `slack_webhook_url_enc TEXT` for AES-256-GCM ciphertext (format: `iv:tag:data` hex, via `lib/crypto.ts`). No SQL backfill — Postgres has no access to `ENCRYPTION_KEY`. The single owner re-saves once via `/settings/businesses` and `lib/business/db.ts` `upsertBusiness()` writes the ciphertext to `_enc` and NULLs the plaintext column.

Read path (`rowFromDb`) prefers `_enc` (decrypts via `decryptIfNeeded`) and falls back to the plaintext column for not-yet-migrated rows. The `BusinessRow` exposed by `lib/business/types.ts` keeps `slack_webhook_url` as the public field — callers don't see the encrypted form.

## Related
- [[business-operators-table-rename]]
