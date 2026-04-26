---
type: atom
title: "A4 — API route: /api/runs"
id: task-a4-runs-api
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L109
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a4]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# A4 — API route: `/api/runs`

New `app/api/runs/route.ts`, `app/api/runs/[id]/route.ts`, and
`app/api/runs/[id]/advance/route.ts`. `GET /api/runs` lists the caller's runs;
`GET /api/runs/[id]` returns the run + event log; `POST /api/runs/[id]/advance`
performs a phase transition. All three: `auth()` + rate-limit + CSRF origin.

Verify: curl returns 401 without an auth cookie, 200 with.

## Related
- [[ecosystem-a-pack]]
