-- 028_molecular_salience.sql
--
-- Adopts the Mission Control Kit's three-layer memory hybrid scoring on top
-- of the existing `mol_atoms` table from migration 021. Adds:
--
--   - salience       — float [0,1], default 0.5. Bumped on relevance feedback.
--   - pinned         — bool, never decays. Owner-curated atoms.
--   - last_used_at   — timestamptz, set whenever an atom enters an agent's
--                      "Relevant memories" block AND the response actually
--                      referenced it (relevance feedback loop).
--   - superseded_by  — slug of a newer atom that replaces this one. ADD-only:
--                      writes never overwrite; they create a new atom and
--                      point this column at the successor. Retrieval skips
--                      atoms with superseded_by set unless explicitly asked.
--
-- The actual hybrid scoring (RRF over FTS5 + cosine + salience boost) lives
-- in lib/molecular/hybrid-search.ts. This migration is just storage.
--
-- pgvector and the `embedding vector(1536)` column already exist on mol_atoms
-- from 021_molecular_mirror.sql — no need to add here.

alter table mol_atoms
  add column if not exists salience      real not null default 0.5,
  add column if not exists pinned        boolean not null default false,
  add column if not exists last_used_at  timestamptz,
  add column if not exists superseded_by text;

comment on column mol_atoms.salience is
  'Relevance score in [0,1]. Bumped +0.1 on each used reference, decays -0.01 on unused access.';
comment on column mol_atoms.pinned is
  'Owner-curated atoms never decay or get archived, even when salience is low.';
comment on column mol_atoms.last_used_at is
  'Set by the relevance feedback loop after /api/chat — only when the response actually referenced this atom.';
comment on column mol_atoms.superseded_by is
  'ADD-only memory pattern. NULL on the active atom; on the older atom holds the new atom slug. Retrieval skips superseded atoms by default.';

-- Indexes for the three-layer query path.
create index if not exists mol_atoms_salience_idx
  on mol_atoms (salience desc) where pinned = false;
create index if not exists mol_atoms_pinned_idx
  on mol_atoms (pinned) where pinned = true;
create index if not exists mol_atoms_active_idx
  on mol_atoms (scope_id) where superseded_by is null;

-- ── RPCs used by lib/molecular/hybrid-search.ts ─────────────────────────────
-- Postgres FTS over title + body_md, ranked by ts_rank_cd.
create or replace function mol_atoms_fts_search(
  q                   text,
  scope               text,
  k                   int,
  include_superseded  boolean default false
) returns table (
  slug          text,
  scope_id      text,
  title         text,
  body_md       text,
  salience      real,
  pinned        boolean,
  last_used_at  timestamptz,
  rank          real
) language sql stable as $$
  select a.slug, a.scope_id, a.title, a.body_md, a.salience, a.pinned, a.last_used_at,
    ts_rank_cd(to_tsvector('english', a.title || ' ' || coalesce(a.body_md, '')), plainto_tsquery('english', q)) as rank
  from mol_atoms a
  where to_tsvector('english', a.title || ' ' || coalesce(a.body_md, '')) @@ plainto_tsquery('english', q)
    and (scope is null or a.scope_id = scope)
    and (include_superseded or a.superseded_by is null)
  order by rank desc
  limit k;
$$;

-- pgvector cosine-similarity search (lower distance = closer match).
create or replace function mol_atoms_vec_search(
  embed               vector(1536),
  scope               text,
  k                   int,
  include_superseded  boolean default false
) returns table (
  slug          text,
  scope_id      text,
  title         text,
  body_md       text,
  salience      real,
  pinned        boolean,
  last_used_at  timestamptz,
  distance      float8
) language sql stable as $$
  select a.slug, a.scope_id, a.title, a.body_md, a.salience, a.pinned, a.last_used_at,
    (a.embedding <=> embed)::float8 as distance
  from mol_atoms a
  where a.embedding is not null
    and (scope is null or a.scope_id = scope)
    and (include_superseded or a.superseded_by is null)
  order by a.embedding <=> embed
  limit k;
$$;
