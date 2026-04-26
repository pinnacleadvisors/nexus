---
type: atom
title: "A11 — Measure phase ingestion"
id: task-a11-measure-phase-ingestion
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L151
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a11]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# A11 — Measure phase ingestion

New `app/api/cron/ingest-metrics/route.ts` and `lib/publish/metrics.ts`. Once per
hour, for every run in `phase=measure`, poll platform analytics for
`views, likes, ctr, conversions` (provider-specific) and update `runs.metrics`
JSONB. When the sample-size threshold is hit, advance to `optimise`.

Verify: mock provider returns; run advances automatically.

## Related
- [[ecosystem-a-pack]]
