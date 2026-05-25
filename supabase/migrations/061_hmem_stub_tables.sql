-- 061_hmem_stub_tables — H-Mem v1 (tables only; consolidation crons land later).
--
-- See task_plan-hmem-architecture.md for the full design. v1 ships the two
-- tables so the MCP `memory_walk` / `memory_timeline` tools and the
-- ecosystem adapter have a real target — even though the consolidation
-- crons that POPULATE the rows ship in a later phase. Reads return empty
-- arrays until then, which the caller treats as "no path found".
--
-- All statements idempotent.

create extension if not exists "uuid-ossp";

-- Temporal-Semantic Tree node: episodic atoms → day-summaries →
-- week-summaries → topic long-term summaries. `superseded_by` lets newer
-- preferences override older summaries without losing audit trail.
create table if not exists public.mol_temporal_node (
  id              uuid          primary key default uuid_generate_v4(),
  scope_id        text          not null,                       -- e.g. 55bedf46-nexus
  level           smallint      not null,                       -- 0=episodic 1=day 2=week 3=topic
  parent_id       uuid          references public.mol_temporal_node(id) on delete set null,
  source_atom_ids uuid[]        not null default '{}'::uuid[],  -- atoms summarised by this node
  title           text          not null,
  body            text          not null,
  ts_start        timestamptz   not null,
  ts_end          timestamptz   not null,
  superseded_by   uuid          references public.mol_temporal_node(id) on delete set null,
  created_at      timestamptz   not null default now()
);

create index if not exists mol_temporal_node_scope_level_idx
  on public.mol_temporal_node (scope_id, level, ts_end desc);

create index if not exists mol_temporal_node_parent_idx
  on public.mol_temporal_node (parent_id) where parent_id is not null;

-- Knowledge graph edge: src --predicate--> dst. Edges can connect atoms,
-- entities, and temporal nodes. `confidence` lets the operator review
-- LLM-extracted edges before they become canonical.
create table if not exists public.mol_edge (
  id            uuid          primary key default uuid_generate_v4(),
  scope_id      text          not null,
  src_kind      text          not null,                          -- 'atom' | 'entity' | 'temporal'
  src_id        uuid          not null,
  predicate     text          not null,                          -- 'mentions' | 'caused' | 'cancelled' | …
  dst_kind      text          not null,
  dst_id        uuid          not null,
  confidence    real          not null default 1.0,              -- 0..1; LLM edges < 1.0
  source        text          not null,                          -- 'wikilink' | 'llm' | 'operator'
  created_at    timestamptz   not null default now(),

  constraint mol_edge_kind_check
    check (src_kind in ('atom','entity','temporal') and dst_kind in ('atom','entity','temporal')),
  constraint mol_edge_source_check
    check (source in ('wikilink','llm','operator'))
);

create index if not exists mol_edge_scope_src_idx on public.mol_edge (scope_id, src_id);
create index if not exists mol_edge_scope_dst_idx on public.mol_edge (scope_id, dst_id);
create index if not exists mol_edge_predicate_idx on public.mol_edge (scope_id, predicate);

alter table public.mol_temporal_node enable row level security;
alter table public.mol_edge          enable row level security;

drop policy if exists mol_temporal_node_service_role_all on public.mol_temporal_node;
create policy mol_temporal_node_service_role_all
  on public.mol_temporal_node for all
  using  (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists mol_edge_service_role_all on public.mol_edge;
create policy mol_edge_service_role_all
  on public.mol_edge for all
  using  (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
