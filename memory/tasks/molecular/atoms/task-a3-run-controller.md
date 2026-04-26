---
type: atom
title: "A3 — Run controller library"
id: task-a3-run-controller
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L103
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a3]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# A3 — Run controller library

New `lib/runs/controller.ts` exporting pure functions `startRun(idea)`,
`advancePhase(runId, to, payload)`, `appendEvent(runId, kind, payload)`,
`getCursor(runId)`. Each phase transition writes both an audit row and a
`run_events` row. Uses Supabase upsert with optimistic `updated_at` guard so
failures never mutate state.

Verify: `node --test` unit stub; no React imports.

## Related
- [[ecosystem-a-pack]]
