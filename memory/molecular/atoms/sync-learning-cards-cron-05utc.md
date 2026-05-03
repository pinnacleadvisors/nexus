---
title: sync-learning-cards cron at 05 UTC
created: 2026-05-02
links:
  - mocs/learning-system
---

# sync-learning-cards cron at 05 UTC

`/api/cron/sync-learning-cards` runs at `0 5 * * *` UTC and reconciles `flashcards` against the `mol_atoms` mirror. New atom → insert with `state='new'`. Atom SHA changed → reset to `learning` with `stale_reason`. Atom no longer in `mol_atoms` → archive (review history kept). MOC navigation cards generated when an MOC has ≥4 atoms. Auth: bearer `CRON_SECRET` OR Clerk owner. The `/learn` page exposes a "Run sync now" button that POSTs to the same route.

Source: `app/api/cron/sync-learning-cards/route.ts`, `lib/learning/atom-sync.ts`.
