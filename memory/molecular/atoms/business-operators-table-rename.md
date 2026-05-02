---
type: atom
title: "business_operators table is the orchestrator config; businesses is the legacy workspace"
id: business-operators-table-rename
created: 2026-05-03
sources:
  - file://supabase/migrations/024_business_operators.sql
  - file://supabase/migrations/003_businesses_milestones.sql
links:
  - "[[slack-webhook-encrypted-at-rest-after-026]]"
status: active
lastAccessed: 2026-05-03
accessCount: 0
---

# business_operators table is the orchestrator config; businesses is the legacy workspace

Migration 024 created `business_operators` (Phase A — autonomous business orchestration: niche, money_model JSONB, kpi_targets, approval_gates, slack_webhook_url, slack_channel, daily_cron_local_hour, current_run_id). Commit b7d1af2 renamed it from the original `businesses` because migration 003 already used that name for the legacy "business workspace" concept consumed by `lib/graph/builder.ts`.

When writing graph code or RLS policies, always check which table you mean:
- `business_operators` (PK `slug TEXT`, RLS `user_id = sub`) — Inngest cron iterates `WHERE status='active'` and dispatches the `business-operator` agent.
- `businesses` (legacy, see migration 003) — workspace concept used by graph builder.

The lib helpers live at `lib/business/db.ts` and `lib/business/types.ts`. The Settings UI at `/settings/businesses` operates on the `business_operators` table despite the URL slug ("businesses").

## Related
- [[slack-webhook-encrypted-at-rest-after-026]]
