---
title: log_events replaces dedicated cron status table
created: 2026-05-02
links:
  - mocs/autonomous-qa
---

# log_events replaces dedicated cron status table

Migration 022 added `log_events` for Vercel log drain. PR 5 of `task_plan-ux-security-onboarding.md` reuses it for cron run tracking instead of adding a `cron_runs` table — `lib/cron/record.ts:recordCronRun(name, fn)` writes structured rows (`route`, `level`, `metadata.duration_ms`, `metadata.error`). `/api/health/cron` queries the same table. Less schema, identical query power. RLS deny-by-default with service-role exception.

Source: `supabase/migrations/022_log_events.sql`, `lib/logs/vercel.ts`.
