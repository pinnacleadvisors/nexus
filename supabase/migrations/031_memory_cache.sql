-- 031_memory_cache.sql
--
-- Phase 20 cache table for GitHub memory reads. The schema previously lived
-- only in lib/schema.sql (the legacy reference doc) and was never promoted
-- into the numbered migration sequence — so `npx supabase gen types` skipped
-- it, and `app/api/memory/route.ts` couldn't compile after types were
-- regenerated. This migration tracks the table so future regenerations
-- include it.
--
-- Idempotent: matches the existing `lib/schema.sql` definition. Safe to apply
-- on a database where the table was hand-created.

create table if not exists memory_cache (
  path        text primary key,
  content     text        not null,
  sha         text        not null,
  cached_at   timestamptz not null default now()
);

create index if not exists memory_cache_cached_at_idx
  on memory_cache (cached_at desc);

comment on table memory_cache is
  '5-minute read-through cache for the GitHub memory repo. Populated by app/api/memory/route.ts. Key is the repo-relative path.';

-- RLS: service-role only — every read goes through the auth-gated route.
alter table memory_cache enable row level security;

drop policy if exists memory_cache_service_only on memory_cache;
create policy memory_cache_service_only on memory_cache
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
