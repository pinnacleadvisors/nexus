---
title: tasks has no idea FK before migration 025
created: 2026-05-02
links:
  - mocs/business-operator
---

# tasks has no idea FK before migration 025

Until migration 025_tasks_lineage.sql, the `tasks` table only references `projects(id) ON DELETE SET NULL`. There is no `idea_id` or `run_id` column. When a user deletes an idea via `DELETE /api/ideas?id=…`, the cascade only hits `automations` (n8n workflows). Board cards remain forever as orphans. PR 3 of `task_plan-ux-security-onboarding.md` adds `idea_id`, `run_id`, `business_slug`, `archived_at` columns plus a nightly orphan sweeper.

Source: `supabase/migrations/002_tasks_and_projects.sql`, `supabase/migrations/010_ideas_and_automations.sql`.
