-- 062_hmem_edge_id_text — fix mol_edge src_id / dst_id to be text-shaped.
--
-- migration 061 declared src_id / dst_id as uuid, but the canonical atoms
-- in mol_atoms are keyed by (scope_id, slug) — neither column is a uuid.
-- We encode atoms / entities / mocs as "<scope_id>:<slug>" and reserve raw
-- UUID strings for mol_temporal_node rows.
--
-- mol_edge has zero rows in production at the time this migration ships
-- (consolidation crons haven't started), so the ALTER is safe. Idempotent
-- on re-run (the alter is a no-op once the column is already text).

alter table public.mol_edge
  alter column src_id type text using src_id::text,
  alter column dst_id type text using dst_id::text;

-- Re-create the indexes if they exist (the type change drops them on some
-- PG versions). Idempotent.
drop index if exists mol_edge_scope_src_idx;
drop index if exists mol_edge_scope_dst_idx;
drop index if exists mol_edge_predicate_idx;

create index mol_edge_scope_src_idx  on public.mol_edge (scope_id, src_id);
create index mol_edge_scope_dst_idx  on public.mol_edge (scope_id, dst_id);
create index mol_edge_predicate_idx  on public.mol_edge (scope_id, predicate);
