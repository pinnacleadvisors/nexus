---
type: atom
title: "A6 — Run-aware session dispatch"
id: task-a6-run-aware-dispatch
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L121
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a6]]"
---

# A6 — Run-aware session dispatch

Edit `app/api/claude-session/dispatch/route.ts` to accept optional `runId`. On
completion, append a `run_events` row with `kind='dispatch.completed'` plus
outputs; if the workflow step is the final one in a phase, call
`advancePhase(runId, nextPhase)`.

Verify: dispatch a step → row in `run_events` → phase advances at the boundary.

## Related
- [[ecosystem-a-pack]]
