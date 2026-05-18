-- Migration: 044_tasks_backfill_business_slug
-- Description: Backfill `tasks.business_slug` from upstream lineage for the
--              pre-025 (and post-025 lineage-less) rows that landed on the
--              board without a slug. Closes audit finding 2026-05-16 P2.6 —
--              the "/graph view emits 13 nodes, 0 edges for asset→biz" gap.
--
-- Sequencing: PR #204 (lib/graph/builder.ts) made the graph builder emit
--              asset→business edges whenever a task has business_slug set.
--              Migration 025 added the column but did NOT backfill — the
--              comment in 025 explicitly says "pre-existing rows stay NULL
--              and the sweep treats them as 'legacy keep'". This migration
--              addresses the same gap for the /graph view: pre-025 rows
--              show as orphans because the slug is missing.
--
-- Chain available in the live schema (no other path works — verified
-- against database.types.ts on 2026-05-18):
--   tasks.run_id → business_operators.current_run_id → business_operators.slug
--
-- Chains that DON'T exist (despite intuition):
--   - tasks.idea_id → ideas.???    : `ideas` has no business_slug column
--   - tasks.run_id  → runs.???     : `runs` has no business_slug column
--   - tasks.project_id → projects.business_id → businesses.id : `businesses`
--     has no slug column, and there's no mapping from businesses.id (UUID)
--     to business_operators.slug (TEXT). Two parallel "business" concepts.
--
-- Expected impact on 2026-05-18: ZERO ROWS. The diagnostic script at
-- scripts/diagnose-tasks-business-slug.mjs reports:
--   - 11 NULL-business_slug rows total
--   - 0 business_operators with current_run_id set
--   - so 0 rows match the JOIN
--
-- The migration is still safe to merge — it's idempotent and serves as a
-- forward safety net: when a business operator gets a current_run_id and
-- has historical tasks bound to that run, re-running this migration (or
-- a follow-up) will backfill the slug.
--
-- For the 11 stale exploration cards already on the board (TikTok affiliate,
-- AI digital products, etc. — none matching current slugs inkbound /
-- ledger-lane), the operator will need to either:
--   1. Manually classify via a CSV-driven follow-up migration
--   2. Accept them as legacy orphans on /graph
--   3. Delete them as no-longer-relevant exploration cards
--
-- All three options are out of scope for this migration. This one only
-- handles the deterministic schema-level path.
--
-- Guarantees:
--   - Idempotent: WHERE business_slug IS NULL ensures re-running is a no-op.
--   - Non-destructive: never overwrites a non-NULL value (operator overrides
--     are preserved).
--   - Logs row count via RAISE NOTICE so the migration runner emits the
--     audit trail in stdout.
--   - No schema changes — migration 025 already added the column.

DO $migration$
DECLARE
  affected_rows INTEGER;
BEGIN
  WITH updated AS (
    UPDATE tasks t
    SET    business_slug = bo.slug,
           updated_at    = NOW()
    FROM   business_operators bo
    WHERE  t.business_slug IS NULL
      AND  t.run_id        IS NOT NULL
      AND  bo.current_run_id = t.run_id
    RETURNING t.id
  )
  SELECT COUNT(*) INTO affected_rows FROM updated;

  RAISE NOTICE
    '[044_tasks_backfill_business_slug] backfilled % rows via business_operators.current_run_id JOIN',
    affected_rows;
END $migration$;
