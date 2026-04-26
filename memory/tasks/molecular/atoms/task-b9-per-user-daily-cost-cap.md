---
type: atom
title: "B9 — Per-user daily cost cap"
id: task-b9-per-user-daily-cost-cap
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L215
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b9]]"
---

# B9 — Per-user daily cost cap

New `lib/cost-guard.ts` hooked into the `token-events` write path. Enforces
`COST_ALERT_PER_RUN_USD` as a **block** (not just alert) when the daily aggregate
crosses `USER_DAILY_USD_LIMIT` (new env var, default $25). `withGuards` accepts
`{costCap:true}` and returns 402 when over.

Verify: seed $26 of token-events for a user → next AI call returns 402.

## Related
- [[ecosystem-b-pack]]
