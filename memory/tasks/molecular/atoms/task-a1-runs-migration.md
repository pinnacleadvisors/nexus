---
type: atom
title: "A1 — Supabase migration: runs state machine"
id: task-a1-runs-migration
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L91
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a1]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# A1 — Supabase migration: `runs` state machine

Add `supabase/migrations/013_runs.sql` (shipped as `015_runs.sql`) creating tables
`runs(id uuid, user_id, idea_id, project_id, phase enum, status enum, cursor jsonb,
metrics jsonb, created_at, updated_at)` plus `run_events` append-only log keyed by
`run_id`. RLS scoped to `auth.jwt()->>'sub'`; indexes on `(user_id, phase)` and
`(run_id, created_at)`.

Verify: `npm run migrate` applies cleanly; two users see only their own rows.

## Related
- [[ecosystem-a-pack]]
