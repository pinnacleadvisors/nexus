---
type: atom
title: "B4 — Auth-gate /api/storage"
id: task-b4-auth-gate-storage
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L185
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b4]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# B4 — Auth-gate `/api/storage`

Edit `app/api/storage/route.ts` to require `auth()` on every verb. Scope
`bucket`/`key` prefixes to `user_id/<path>` — reject any request whose key does
not start with the caller's user ID. Prevents cross-user access even when service
role is in use.

Verify: user A cannot list user B's prefix.

## Related
- [[ecosystem-b-pack]]
