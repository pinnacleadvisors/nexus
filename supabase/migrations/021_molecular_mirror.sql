-- 021_molecular_mirror.sql
--
-- Read cache for the central memory-hq graph. Source of truth is the
-- pinnacleadvisors/memory-hq GitHub repo; rows here are upserted by the
-- /api/cron/sync-memory webhook on push events. If this table drifts,
-- re-run the nightly reconcile job to replay from GitHub.
--
-- One table per kind keeps queries simple and indexes small. JSONB
-- frontmatter preserves arbitrary fields (locators, scope, etc.) without
-- schema churn.

create extension if not exists vector;

create table if not exists mol_atoms (
  slug          text not null,
  scope_id      text not null,
  title         text not null,
  body_md       text not null default '',
  frontmatter   jsonb not null default '{}'::jsonb,
  sha           text not null,
  path          text not null,
  embedding     vector(1536),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (scope_id, slug)
);

create table if not exists mol_entities (
  slug          text not null,
  scope_id      text not null,
  title         text not null,
  entity_kind   text,
  body_md       text not null default '',
  frontmatter   jsonb not null default '{}'::jsonb,
  sha           text not null,
  path          text not null,
  embedding     vector(1536),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (scope_id, slug)
);

create table if not exists mol_mocs (
  slug          text not null,
  scope_id      text not null,
  title         text not null,
  body_md       text not null default '',
  frontmatter   jsonb not null default '{}'::jsonb,
  sha           text not null,
  path          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (scope_id, slug)
);

create table if not exists mol_sources (
  slug          text not null,
  scope_id      text not null,
  title         text not null,
  body_md       text not null default '',
  frontmatter   jsonb not null default '{}'::jsonb,
  sha           text not null,
  path          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (scope_id, slug)
);

create table if not exists mol_synthesis (
  slug          text not null,
  scope_id      text not null,
  title         text not null,
  body_md       text not null default '',
  frontmatter   jsonb not null default '{}'::jsonb,
  sha           text not null,
  path          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (scope_id, slug)
);

-- Indexes — narrow scans for the common query shapes.
create index if not exists mol_atoms_scope_idx       on mol_atoms (scope_id);
create index if not exists mol_atoms_author_idx      on mol_atoms ((frontmatter ->> 'author'));
create index if not exists mol_atoms_kind_idx        on mol_atoms ((frontmatter ->> 'kind'));
create index if not exists mol_atoms_importance_idx  on mol_atoms ((frontmatter ->> 'importance'));
create index if not exists mol_atoms_fts_idx         on mol_atoms using gin (to_tsvector('english', title || ' ' || body_md));
create index if not exists mol_entities_scope_idx    on mol_entities (scope_id);
create index if not exists mol_entities_kind_idx     on mol_entities (entity_kind);

-- pgvector: ivfflat for atoms/entities. Tune `lists` after first import (~ rows / 1000).
create index if not exists mol_atoms_embedding_idx
  on mol_atoms using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index if not exists mol_entities_embedding_idx
  on mol_entities using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Touch trigger keeps updated_at honest.
create or replace function mol_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists mol_atoms_touch       on mol_atoms;
drop trigger if exists mol_entities_touch    on mol_entities;
drop trigger if exists mol_mocs_touch        on mol_mocs;
drop trigger if exists mol_sources_touch     on mol_sources;
drop trigger if exists mol_synthesis_touch   on mol_synthesis;

create trigger mol_atoms_touch       before update on mol_atoms       for each row execute function mol_touch();
create trigger mol_entities_touch    before update on mol_entities    for each row execute function mol_touch();
create trigger mol_mocs_touch        before update on mol_mocs        for each row execute function mol_touch();
create trigger mol_sources_touch     before update on mol_sources     for each row execute function mol_touch();
create trigger mol_synthesis_touch   before update on mol_synthesis   for each row execute function mol_touch();
