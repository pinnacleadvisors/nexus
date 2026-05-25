-- 065_mol_edge_approval — operator gate for LLM-extracted edges.
--
-- v4 shipped /api/cron/hmem-extract-edges which writes mol_edge rows with
-- source='llm' directly. v5 adds an approval gate: LLM-extracted edges
-- land with pending_approval=true, then either approved (decided_at + by)
-- or rejected (decided_at + by + a -deleted flag via simple boolean).
--
-- Wikilink + operator edges (source ∈ {'wikilink','operator'}) bypass the
-- gate — they're inherently trusted.
--
-- The walk endpoint (/api/memory/walk) filters pending=true edges out of
-- the traversal by default (callers can opt in via ?include_pending=true).
--
-- Idempotent.

alter table public.mol_edge
  add column if not exists pending_approval  boolean      not null default false,
  add column if not exists decided_at        timestamptz,
  add column if not exists decided_by        text,
  add column if not exists decision          text;

-- Partial index for the operator inbox — pending-only walk is the hot path.
create index if not exists mol_edge_pending_idx
  on public.mol_edge (scope_id, source, created_at desc)
  where pending_approval = true;

-- Sanity constraint: decision is one of approve / reject when set.
alter table public.mol_edge
  drop constraint if exists mol_edge_decision_check;
alter table public.mol_edge
  add constraint mol_edge_decision_check
  check (decision is null or decision in ('approve', 'reject'));
