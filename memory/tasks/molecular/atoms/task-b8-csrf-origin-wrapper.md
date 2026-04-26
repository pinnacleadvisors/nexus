---
type: atom
title: "B8 — CSRF origin check wrapper"
id: task-b8-csrf-origin-wrapper
created: 2026-04-26
status: planned
sources:
  - task_plan.md#L209
links:
  - "[[ecosystem-b-pack]]"
---

# B8 — CSRF origin check wrapper

New `lib/withGuards.ts` consolidating `assertOrigin(req)` (existing `lib/csrf.ts`),
`auth()`, and `ratelimit(userId, route)` into a single
`withGuards(handler, {rateLimit, csrf:true})` wrapper. Apply to every
POST/PUT/DELETE handler in `app/api/*`, starting with the 10 most-called routes
behind a feature flag.

Verify: cross-site fetch to any mutating route → 403; same-origin works.

## Related
- [[ecosystem-b-pack]]
