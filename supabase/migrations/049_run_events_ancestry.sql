-- 049_run_events_ancestry.sql
--
-- Phase 2 (Paperclip absorption) — link run_events to their goal/issue ancestry
-- so the dashboard can render "this dispatch served goal X via issue Y" without
-- joining through agent-state JSON.
--
-- See: docs/research/paperclip-audit-2026-05.md §2
--      task_plan-paperclip-absorption.md (Task 2d)
--      lib/runs/log.ts (caller; strips columns when migration is missing)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. No FKs (run_events writes are heavy;
-- adding FK constraints would couple the write path to goals/issues table
-- liveness — at this layer we want soft references that can dangle).
--
-- Paired helper: lib/runs/log.ts (strip-on-missing-column pattern, mirrors
-- lib/board/insert-task.ts so n8n/Inngest/Stripe webhook auto-retries do not
-- storm if a deploy lands ahead of the migration).

alter table run_events
  add column if not exists goal_id  uuid null;

alter table run_events
  add column if not exists issue_id uuid null;

-- Index for the dashboard's "events for this goal" / "events for this issue"
-- queries. Partial index — most run_events rows pre-migration are NULL for
-- both, so the partial saves significant disk + speeds up lookups.
create index if not exists run_events_goal_idx
  on run_events(goal_id, created_at desc)
  where goal_id is not null;

create index if not exists run_events_issue_idx
  on run_events(issue_id, created_at desc)
  where issue_id is not null;

comment on column run_events.goal_id is
  'Optional soft reference to goals(id). Not an FK — run_events is a heavy write path; we accept dangling references over coupling write throughput to goals table availability.';
comment on column run_events.issue_id is
  'Optional soft reference to issues(id). Same rationale as goal_id — soft reference, not FK.';
