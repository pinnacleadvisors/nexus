---
type: moc
title: "Pillar C — Self-optimising performance"
id: ecosystem-c-pack
created: 2026-04-26
sources:
  - task_plan.md#L239
links:
  - "[[task-c1-observability-metric-samples]]"
  - "[[task-c2-regression-detector]]"
  - "[[task-c3-prompt-cache-optimiser]]"
  - "[[task-c4-library-promotion]]"
  - "[[task-c5-experiment-harness]]"
  - "[[task-c6-adaptive-routing-feedback]]"
  - "[[task-c7-graph-aware-chat-cache]]"
  - "[[task-c8-nightly-graph-rebuild]]"
---

# Pillar C — Self-optimising performance

The 8 tasks (C1–C8) that observe the platform's own performance, detect regressions,
promote winning prompts to a library, and cache stable graph context for prompt-cache
hits. Sequenced after Pillar A so the runs/metrics plumbing exists.

## Tasks
- [[task-c1-observability-metric-samples]] — `lib/observability.ts` + `metric_samples` table
- [[task-c2-regression-detector]] — Daily 7-day vs 24-hour p50/p95 regression sweep
- [[task-c3-prompt-cache-optimiser]] — Anthropic prompt-cache prefix marking + cache stats
- [[task-c4-library-promotion]] — Successful runs promoted to `library` table on `done`
- [[task-c5-experiment-harness]] — `experiments` table + variant z-test winner pick
- [[task-c6-adaptive-routing-feedback]] — Router Q-table 14-day exponential decay
- [[task-c7-graph-aware-chat-cache]] — `/api/chat` short-circuits when one atom dominates
- [[task-c8-nightly-graph-rebuild]] — `POST /api/cron/rebuild-graph` emits node/orphan metrics

## Related
- [[ecosystem-a-pack]]
- [[ecosystem-b-pack]]
