---
type: atom
title: "B5 — Auth-gate /api/audit"
id: task-b5-auth-gate-audit
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L191
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b5]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# B5 — Auth-gate `/api/audit`

Edit `app/api/audit/route.ts` to require `auth()`. Force the `userId` query param
to equal the caller (owner can override via `ALLOWED_USER_IDS` membership). Strip
`resource`/`action` filters of SQL-sensitive characters (already parameterised but
belt-and-braces).

Verify: caller A cannot read B's audit entries; owner can read all.

## Related
- [[ecosystem-b-pack]]
