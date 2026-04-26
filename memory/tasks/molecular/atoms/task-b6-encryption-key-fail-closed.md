---
type: atom
title: "B6 — Encryption key fail-closed"
id: task-b6-encryption-key-fail-closed
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L197
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b6]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# B6 — Encryption key fail-closed

Edit `lib/crypto.ts` so that in production it throws on import when
`ENCRYPTION_KEY` is unset or not 64 hex chars. Dev fallback remains but emits a
loud console warning. Add `rotateKey(oldKey, newKey)` utility and document the
rotation procedure in `memory/platform/SECRETS.md` (decrypt + re-encrypt all OAuth
tokens in one transaction).

Verify: `NODE_ENV=production ENCRYPTION_KEY= node -e "require('./lib/crypto')"`
throws.

## Related
- [[ecosystem-b-pack]]
