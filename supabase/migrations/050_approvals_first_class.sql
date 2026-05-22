-- 050_approvals_first_class.sql
--
-- Phase 2 (Paperclip absorption) — first-class approvals table replacing the
-- JSONB approval_gates list on business_operators.
--
-- See: docs/research/paperclip-audit-2026-05.md §5 (approval flow)
--      docs/adr/007-paperclip-absorption.md
--      task_plan-paperclip-absorption.md (Task 2e)
--
-- Each row is one gate awaiting (or having received) a decision. The 5-category
-- gate matrix from the solopreneur-loop spec becomes the typed `type` column;
-- this preserves Nexus's domain-specific gating while gaining the queryable
-- inbox surface from Paperclip.
--
-- Backstop: business_operators.approval_gates JSONB stays untouched. The
-- /approvals UI reads BOTH (table when present, JSONB when not). Once table
-- adoption is verified the JSONB can be removed in a later migration.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; DROP POLICY IF EXISTS.
--
-- Paired helper: lib/approvals/insert.ts (strip-on-missing-table pattern)

create table if not exists approvals (
  id              uuid          primary key default gen_random_uuid(),
  business_slug   text          not null
                                references business_operators(slug) on delete cascade,
  type            text          not null
                                check (type in (
                                  'niche_pick',
                                  'domain_purchase',
                                  'first_n_posts',
                                  'paid_saas_signup',
                                  'pricing_change'
                                )),
  status          text          not null default 'pending'
                                check (status in ('pending','approved','rejected','cancelled')),
  payload         jsonb         not null default '{}'::jsonb,
  created_by_agent text         null,
  created_at      timestamptz   not null default now(),
  decided_at      timestamptz   null,
  decided_by_user text          null,
  decision_note   text          null
);

-- Primary access pattern: the unified /approvals inbox lists pending rows
-- across ALL businesses, sorted by created_at desc.
create index if not exists approvals_pending_idx
  on approvals(created_at desc)
  where status = 'pending';

-- Secondary: per-business approval lookup.
create index if not exists approvals_business_idx
  on approvals(business_slug, status, created_at desc);

alter table approvals enable row level security;

drop policy if exists approvals_service_role_all on approvals;
create policy approvals_service_role_all on approvals
  for all using (true) with check (true);

comment on table approvals is
  'Domain-typed approval gates. Replaces business_operators.approval_gates JSONB list per ADR-007. The 5 enum values mirror the solopreneur-loop spec exactly — adding a 6th type requires both this CHECK constraint update AND a strategist code change.';
comment on column approvals.type is
  'One of: niche_pick | domain_purchase | first_n_posts | paid_saas_signup | pricing_change. Domain-specific irreversible-decision categories, NOT generic.';
comment on column approvals.payload is
  'Per-type structured data — e.g. niche_pick carries {niche, rationale, competitors}, domain_purchase carries {domain, registrar, estimated_cost_usd}. Shape varies by type; agents writing here must match the type schema documented in solopreneur-loop spec.';
comment on column approvals.decided_at is
  'Set when status leaves "pending". NULL while still pending.';
