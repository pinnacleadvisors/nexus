---
type: moc
title: "Pillar A — Close the idea → exec → optimise loop"
id: ecosystem-a-pack
created: 2026-04-26
sources:
  - task_plan.md#L89
links:
  - "[[task-a1-runs-migration]]"
  - "[[task-a2-run-types]]"
  - "[[task-a3-run-controller]]"
  - "[[task-a4-runs-api]]"
  - "[[task-a5-forge-run-creation]]"
  - "[[task-a6-run-aware-dispatch]]"
  - "[[task-a7-graph-keyed-context]]"
  - "[[task-a8-reasoning-feedforward]]"
  - "[[task-a9-metric-triggered-optimiser]]"
  - "[[task-a10-publish-distribute]]"
  - "[[task-a11-measure-phase-ingestion]]"
  - "[[task-a12-self-build-diff-viewer]]"
---

# Pillar A — Close the idea → exec → optimise loop

The 12 tasks (A1–A12) that wire Nexus's existing surfaces into a closed
idea → execution → measurement → self-optimisation loop. Each task is a 2–5 minute
implementation; sequencing follows the critical path documented in `task_plan.md`.

## Tasks
- [[task-a1-runs-migration]] — Supabase `runs` + `run_events` migration
- [[task-a2-run-types]] — `Run`, `RunPhase`, `RunStatus`, `RunEvent`, `RunMetrics` in `lib/types.ts`
- [[task-a3-run-controller]] — `lib/runs/controller.ts` pure functions
- [[task-a4-runs-api]] — `/api/runs` GET/POST/advance routes
- [[task-a5-forge-run-creation]] — Forge "Build this" → POST /api/runs
- [[task-a6-run-aware-dispatch]] — Dispatch route accepts `runId` and advances phases
- [[task-a7-graph-keyed-context]] — `GraphRetriever` + TokenOptimiser cap
- [[task-a8-reasoning-feedforward]] — ReasoningBank past-plan injection in Queen
- [[task-a9-metric-triggered-optimiser]] — Cron writes metric-drift `workflow_feedback`
- [[task-a10-publish-distribute]] — `/api/publish` + provider abstraction (YouTube live)
- [[task-a11-measure-phase-ingestion]] — Hourly cron pulls platform analytics
- [[task-a12-self-build-diff-viewer]] — Board diff viewer + approve/reject merge

## Related
- [[ecosystem-b-pack]]
- [[ecosystem-c-pack]]
