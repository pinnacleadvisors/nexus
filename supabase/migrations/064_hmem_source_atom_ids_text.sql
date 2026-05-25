-- 064_hmem_source_atom_ids_text — finish the H-Mem type alignment.
--
-- Migration 061 declared mol_temporal_node.source_atom_ids as uuid[]. Like
-- mol_edge.src_id (already fixed in migration 062), atoms are keyed by
-- (scope_id, slug) — neither is a uuid. We store source atoms as text
-- ids of the shape "<scope_id>:<slug>" so the cron at
-- /api/cron/hmem-consolidate can insert without a type error.
--
-- mol_temporal_node has zero rows in production at the time this migration
-- ships (no consolidation has run yet) — safe alter. Idempotent on re-run.

alter table public.mol_temporal_node
  alter column source_atom_ids type text[] using source_atom_ids::text[];
