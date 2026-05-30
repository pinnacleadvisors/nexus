-- 101 — widen mol_edge for the structural ecosystem index (Akashic Thread A).
--
-- H-Mem's mol_edge (migration 061) only modelled atom|entity|temporal edges —
-- it could not hold the ecosystem's OWN structure (agent→uses→tool,
-- skill→extends→harness). This widens the kind CHECK to allow 'structural'
-- src/dst and the source CHECK to allow 'indexer' (the deterministic cron that
-- writes them — distinct from 'llm' edges, which gate on pending_approval).
--
-- Structural edges land pending_approval=false (definitive — read from the live
-- registries, not inferred), so /api/memory/walk traverses them immediately.
-- Idempotent: drop-then-add so re-running is a no-op; existing rows untouched.

alter table public.mol_edge drop constraint if exists mol_edge_kind_check;
alter table public.mol_edge add constraint mol_edge_kind_check
  check (
    src_kind in ('atom','entity','temporal','structural')
    and dst_kind in ('atom','entity','temporal','structural')
  );

alter table public.mol_edge drop constraint if exists mol_edge_source_check;
alter table public.mol_edge add constraint mol_edge_source_check
  check (source in ('wikilink','llm','operator','indexer'));
