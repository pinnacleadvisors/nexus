-- 093_audit_realtime_publication.sql
--
-- Enable Supabase Realtime on the anon-readable activity tables the
-- Bloomberg-terminal /audit panes subscribe to (Group B of
-- task_plan-bloomberg-audit.md). The browser anon client receives
-- postgres_changes only for rows it can SELECT under RLS, so we add ONLY
-- the already-anon-readable tables:
--   - audit_log        (no RLS — anon reads)
--   - approvals        (RLS policy `using(true)`)
--   - tool_call_audit  (RLS select policy `using(true)`)
--
-- INTENTIONALLY OMITTED:
--   - run_events    — RLS scoped to the JWT `sub` claim; the anon client has
--                     no Clerk JWT, so Realtime would deliver nothing.
--   - gateway_turns — RLS restricted to `auth.role() = 'service_role'`.
-- Those panes read via the owner-gated service-role Server Action instead
-- (app/(protected)/audit/actions.ts) — no RLS was loosened for this feature.
--
-- Idempotent: each ALTER is guarded by a pg_publication_tables check, mirroring
-- migrations 003_businesses_milestones.sql + 006_swarm.sql. `agents` is already
-- in the publication (001_initial_schema.sql) and powers the Agents pane.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'audit_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE audit_log;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'approvals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE approvals;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tool_call_audit'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tool_call_audit;
  END IF;
END $$;
