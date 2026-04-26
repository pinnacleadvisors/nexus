---
type: atom
title: "B2 — Auth-gate /api/content/{generate,score,variants}"
id: task-b2-auth-gate-content
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L173
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b2]]"
---

# B2 — Auth-gate `/api/content/{generate,score,variants}`

Edit each of the three content routes to apply `auth()` + rate-limit + audit. The
`variants` route additionally records `runId` + `variantId` (when supplied) so
A11/C5 can join on it.

Verify: unauthenticated → 401; authenticated → token-event row written.

## Related
- [[ecosystem-b-pack]]
