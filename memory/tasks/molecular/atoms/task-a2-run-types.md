---
type: atom
title: "A2 — Types for Run + RunEvent"
id: task-a2-run-types
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L97
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a2]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# A2 — Types for Run + RunEvent

Add `Run`, `RunPhase`, `RunStatus`, `RunEvent`, and `RunMetrics` interfaces to
`lib/types.ts`. `RunMetrics` carries CTR, conversion, tokenCost, reviewRejects,
latencyP50.

Verify: `npx tsc --noEmit`. Downstream tasks import these so it must land before
A3+.

## Related
- [[ecosystem-a-pack]]
