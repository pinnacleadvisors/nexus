---
type: atom
title: "Manual — SQL migrations applied table (001–008)"
id: manual-supabase-sql-migrations-table
created: 2026-04-26
sources:
  - ROADMAP.md#L40
links:
  - "[[manual-steps]]"
---

# Manual — SQL migrations applied table (001–008)

All 8 migrations applied ✅. `001_initial_schema` (agents, revenue_events, token_events, alert_thresholds, schema_migrations); `002_tasks_and_projects` (Kanban + Realtime); `003_businesses_milestones` (businesses, milestones, user_id, Realtime); `004_rls_policies` (RLS via Clerk JWT sub); `005_audit_log` (with indexes); `006_swarm` (swarm_runs, swarm_tasks, reasoning_patterns); `007_libraries` (code_snippets, agent_templates, prompt_templates, skill_definitions; GIN tag indexes; RLS); `008_agent_hierarchy` (parent_agent_id, layer, tokens, cost; agent_actions table). Adding a new migration: create `supabase/migrations/NNN_description.sql`, add a row, run `npm run migrate`.

## Related
- [[manual-steps]]
