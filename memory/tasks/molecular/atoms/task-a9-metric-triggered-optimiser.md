---
type: atom
title: "A9 — Metric-triggered optimiser"
id: task-a9-metric-triggered-optimiser
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L139
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a9]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# A9 — Metric-triggered optimiser

New `lib/runs/metric-triggers.ts` and `app/api/cron/metric-optimiser/route.ts`.
Scheduled job scans `runs`, `workflow_changelog`, and `token-events`. For each
agent: if p95 token cost exceeds budget AND last 5 runs failed review, enqueue a
`workflow_feedback` row with `feedback="metric-drift: <metric>=<value>"` and
`agentSlug` inferred from `run_events`. The existing `workflow-optimizer` picks
it up.

Verify: seed fake metrics above threshold → row appears in `workflow_feedback`.

## Related
- [[ecosystem-a-pack]]
