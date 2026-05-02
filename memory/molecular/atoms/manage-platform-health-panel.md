---
type: atom
title: "/manage-platform Health tab is the visible-failure surface"
id: manage-platform-health-panel
created: 2026-05-03
sources:
  - file://app/(protected)/manage-platform/page.tsx
  - file://components/admin/HealthPanel.tsx
  - file://app/api/health/cron/route.ts
links:
  - "[[orphan-sweep-cron]]"
status: active
lastAccessed: 2026-05-03
accessCount: 0
---

# /manage-platform Health tab is the visible-failure surface

The `/manage-platform` page has three tabs: Console, Research, Health. The Health tab (`components/admin/HealthPanel.tsx`) is where the operator notices when something breaks. Two sections:

1. **Cron jobs** — table of every cron in `vercel.json` with its schedule, last run timestamp, last HTTP status, and a green/amber/red verdict. Sourced from `GET /api/health/cron`. The verdict logic is per-cron: `>= 500` is red; `>= 400` is amber; "no invocation in N× the schedule period" goes amber/red on `expectedAfterMs`/`redAfterMs`. Last-run data comes from the `log_events` mirror filled by the Vercel log-drain — if the drain isn't wired, every cron shows "Unknown".

2. **Orphan-card sweep** — preview button POSTs `?dryRun=1` to `/api/cron/sweep-orphan-cards`, shows count + sample, then "Confirm delete" runs without the flag. Same endpoint as the nightly cron, owner-gated via `ALLOWED_USER_IDS`.

Add new cron jobs to BOTH `vercel.json` AND the `CRONS` array in `app/api/health/cron/route.ts` so they appear in the panel.

## Related
- [[orphan-sweep-cron]]
