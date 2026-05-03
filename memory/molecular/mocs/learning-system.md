---
title: Learning System
created: 2026-05-02
type: moc
---

# Learning System — Map of Content

Phase 23: Duolingo-style spaced-repetition surface. Atoms in `mol_atoms` (synced from `pinnacleadvisors/memory-hq`) generate flashcards via `lib/learning/atom-sync.ts`. FSRS-4 scheduler tracks state per card. Daily cron at `0 5 * * *` UTC reconciles cards against atoms. `/learn` page exposes "Run sync now" button for ad-hoc sync.

## Atoms
- [[atoms/sync-learning-cards-cron-05utc|sync-learning-cards cron at 05 UTC]]
- [[atoms/sync-memory-uses-github-webhook-hmac|sync-memory uses GitHub webhook HMAC]]

## Entities
- `lib/learning/atom-sync.ts` — reconciliation logic
- `lib/learning/fsrs.ts` — FSRS-4 scheduler
- `lib/learning/card-generator.ts` — atom → card seeds
- `app/api/cron/sync-learning-cards/route.ts` — cron entrypoint
- `app/(protected)/learn/page.tsx` — UI surface
- `supabase/migrations/021_molecular_mirror.sql` — `mol_*` mirror tables
- `supabase/migrations/023_learning_system.sql` — `flashcards` table

## Related
- `task_plan-learning-system.md` — implementation plan
- Phase 23 in `memory/roadmap/SUMMARY.md`
