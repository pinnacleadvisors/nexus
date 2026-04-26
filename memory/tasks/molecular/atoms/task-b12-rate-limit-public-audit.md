---
type: atom
title: "B12 — Rate-limit audit on public surfaces"
id: task-b12-rate-limit-public-audit
created: 2026-04-26
status: planned
sources:
  - task_plan.md#L233
links:
  - "[[ecosystem-b-pack]]"
---

# B12 — Rate-limit audit on public surfaces

Edit `lib/ratelimit.ts` and audit every public route (sign-in, OAuth callback,
webhooks) so each gets its own bucket — no single abuser can DOS auth. Document
the bucket strategy in a README snippet.

Verify: an automated burst-test script triggers the documented limit before any
5xx.

## Related
- [[ecosystem-b-pack]]
