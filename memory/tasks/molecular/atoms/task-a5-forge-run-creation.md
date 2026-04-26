---
type: atom
title: "A5 — Wire forge idea → run creation"
id: task-a5-forge-run-creation
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L115
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a5]]"
---

# A5 — Wire forge idea → run creation

Edit `app/(protected)/forge/page.tsx` and `components/forge/ForgeActionBar.tsx`:
the "Build this" button POSTs to `/api/runs` with `{ideaId}`, then routes to
`/board?runId=...`. If a run already exists for the idea, resume it (idempotent
`startRun`).

Verify: click → row in Supabase → refresh → board card lands in the column matching
`phase`.

## Related
- [[ecosystem-a-pack]]
