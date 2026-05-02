---
type: atom
title: "/learn cron runs at 05:00 UTC; page has a manual Sync now button"
id: learn-page-cron-runs-at-05-utc-with-manual-button
created: 2026-05-03
sources:
  - file://app/api/cron/sync-learning-cards/route.ts
  - file://app/(protected)/learn/page.tsx
  - file://vercel.json
links:
  - "[[manage-platform-health-panel]]"
status: active
lastAccessed: 2026-05-03
accessCount: 0
---

# /learn cron runs at 05:00 UTC; page has a manual Sync now button

`/api/cron/sync-learning-cards` materialises `flashcards` rows from `mol_atoms` via `syncCardsFromMolecular(userId)` in `lib/learning/atom-sync.ts`. Schedule in `vercel.json`: `"0 5 * * *"` — daily 05:00 UTC. Auth: Vercel `CRON_SECRET` bearer OR signed-in owner (uses `OWNER_USER_ID` env or first entry in `ALLOWED_USER_IDS`).

The `/learn` page (Client Component, `app/(protected)/learn/page.tsx`) shows:
- Last sync time (relative; pulled from the new `lastSyncedAt` field in `LearnStats` — most-recent `flashcards.updated_at`)
- Cron schedule inline ("Cron: 05:00 UTC daily")
- A **Sync now** button that POSTs to the cron endpoint and refreshes the path + stats on success
- An empty-state message that explicitly tells the operator to either click Sync or seed atoms via `cli.mjs atom`

When users see "No cards yet", they don't have to wait until 05:00 UTC — the manual button forces an immediate sync. Errors surface inline as a red banner.

## Related
- [[manage-platform-health-panel]]
