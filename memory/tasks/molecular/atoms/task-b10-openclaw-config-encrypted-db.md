---
type: atom
title: "B10 — OpenClaw config → encrypted DB column"
id: task-b10-openclaw-config-encrypted-db
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L221
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b10]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# B10 — OpenClaw config → encrypted DB column

Edit `app/api/claw/config/route.ts` and add a `user_secrets` table
(`supabase/migrations/014_user_secrets.sql`). Migrate the cookie-based gateway URL
+ bearer into an encrypted column (via `lib/crypto.ts`, RLS-scoped to user). The
cookie flow becomes a deprecated fallback with a logged warning; remove after 30
days.

Verify: existing users keep working; new users never see the bearer in client
cookies.

## Related
- [[ecosystem-b-pack]]
