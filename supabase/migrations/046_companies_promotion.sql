-- 046_companies_promotion.sql
--
-- Phase 2 (Paperclip absorption) — promote business_operators toward a
-- Paperclip-shaped `companies` entity. Three additive columns, all NULL-able
-- so existing rows are unaffected.
--
-- See: docs/research/paperclip-audit-2026-05.md §2 (schema mapping)
--      docs/adr/007-paperclip-absorption.md
--      task_plan-paperclip-absorption.md (Task 2a)
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Re-running this migration is a no-op.
--
-- Why additive-only on business_operators rather than a fresh `companies`
-- table? Per audit §10 — business_operators is already very company-like
-- (slug PK, name, niche, money_model JSONB, kpi_targets JSONB, approval_gates
-- JSONB, slack_channel). Renaming the table would cascade-break the
-- business_slug partition key on experiment_metrics, token_events,
-- run_events, connected_accounts, tasks. Promotion-in-place is the simpler
-- fail-soft path.
--
-- Paired helper: lib/business/insert.ts strips these columns when the migration
-- is missing in older runtime instances.

alter table business_operators
  add column if not exists mission       text         null;

alter table business_operators
  add column if not exists board_members jsonb        not null default '[]'::jsonb;

alter table business_operators
  add column if not exists parent_org_id text         null
    references business_operators(slug) on delete set null;

create index if not exists business_operators_parent_org_idx
  on business_operators(parent_org_id)
  where parent_org_id is not null;

comment on column business_operators.mission is
  'Company-level mission statement. Promoted from Paperclip companies.mission per ADR-007. Free-text; agents inject into dispatch prompts.';
comment on column business_operators.board_members is
  'JSONB array of {user_id, role} pairs. Empty by default (single-owner). Reserved for future multi-board governance — see Paperclip doc/SPEC.md §1.';
comment on column business_operators.parent_org_id is
  'Optional parent business — supports parent-org hierarchies (e.g. ProductCo → AcquiredSub). NULL by default; self-referencing FK with ON DELETE SET NULL so deleting a parent does not cascade-delete children.';
