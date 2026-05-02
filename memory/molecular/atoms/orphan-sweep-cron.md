---
type: atom
title: "Orphan-sweep cron deletes stale Kanban cards nightly"
id: orphan-sweep-cron
created: 2026-05-03
sources:
  - file://app/api/cron/sweep-orphan-cards/route.ts
  - file://vercel.json
links:
  - "[[tasks-table-has-no-idea-fk-before-migration-025]]"
  - "[[manage-platform-health-panel]]"
status: active
lastAccessed: 2026-05-03
accessCount: 0
---

# Orphan-sweep cron deletes stale Kanban cards nightly

`POST /api/cron/sweep-orphan-cards` detects two orphan classes and deletes them. Runs nightly at 04:30 UTC (10 min after sync-memory; before sync-learning-cards at 05:00). Auth: Vercel `CRON_SECRET` bearer OR a signed-in user in `ALLOWED_USER_IDS` (used by the admin button on `/manage-platform` → Health tab).

Detection rules:
1. **run_deleted** — `run_id IS NOT NULL` but the run row no longer exists. Catches post-025 cards whose run was deleted directly.
2. **legacy_orphan_30d** — `idea_id IS NULL AND run_id IS NULL AND business_slug IS NULL AND project_id IS NULL AND column_id IN ('backlog','in-progress') AND updated_at < NOW() - 30 days`. Catches the legacy backlog from idea "Run" clicks before migration 025.

Dry-run mode (`?dryRun=1` or any GET) returns counts + a 10-row sample; actual delete only on POST without the flag. Every invocation writes one `audit_log` row with action `tasks.orphan_sweep_dry_run` or `tasks.orphan_sweep_delete`.

## Related
- [[tasks-table-has-no-idea-fk-before-migration-025]]
- [[manage-platform-health-panel]]
