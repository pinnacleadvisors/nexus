---
type: atom
title: "tasks table had no idea/run FK before migration 025"
id: tasks-table-has-no-idea-fk-before-migration-025
created: 2026-05-03
sources:
  - file://supabase/migrations/002_tasks_and_projects.sql
  - file://supabase/migrations/025_tasks_lineage.sql
  - file://task_plan-platform-improvements.md
links:
  - "[[orphan-sweep-cron]]"
status: active
lastAccessed: 2026-05-03
accessCount: 0
---

# tasks table had no idea/run FK before migration 025

Before migration 025_tasks_lineage, the `tasks` Kanban table had only `project_id` (FK to a workspace) and `milestone_id` (a string label, not a FK). Deleting an idea via `DELETE /api/ideas` therefore left every card it spawned dangling on the board with no way to detect the orphan via JOIN.

Migration 025 adds `idea_id UUID REFERENCES ideas(id) ON DELETE SET NULL`, `run_id UUID REFERENCES runs(id) ON DELETE SET NULL`, and `business_slug TEXT` (loose link, no FK so archived business rows don't cascade-delete cards). Indexes on each, partial WHERE NOT NULL.

Existing rows stay NULL — backfill was rejected (legacy-keep policy). The orphan-sweep cron uses a heuristic for legacy cards: `column_id IN ('backlog','in-progress') AND idea_id IS NULL AND run_id IS NULL AND business_slug IS NULL AND project_id IS NULL AND updated_at < NOW() - 30 days`.

## Related
- [[orphan-sweep-cron]]
