-- Migration 078 — shared LLM voice cache for A/B comparisons.
--
-- PR #377 plumbed synthetic_voice='llm' through A/B mode but each
-- policy run independently called voiceLLM(), giving:
--   (a) N × cost (3-policy A/B = 3× spend)
--   (b) sampling variance — same (persona, ticket) → different bodies
--       per run, which adds noise to the comparison
--
-- This cache lets startAB() pre-compute one body per (seed, event-coord)
-- ONCE and share across every run in the group. Single LLM call per
-- event; every engine reads the same body.
--
-- Key is (seed, sim_day, sim_hour) — that triple uniquely identifies
-- an event in the timeline (same seed → same Monte Carlo output).

create table if not exists simulation_voice_cache (
  seed       text         not null,
  sim_day    int          not null,
  sim_hour   numeric(5,2) not null,
  persona_id text         not null,
  body       text         not null,
  created_at timestamptz  not null default now(),
  primary key (seed, sim_day, sim_hour, persona_id)
);

-- Index for retrieval by seed alone (warm-cache check at startAB time).
create index if not exists simulation_voice_cache_seed_idx
  on simulation_voice_cache(seed);

alter table simulation_voice_cache enable row level security;

drop policy if exists simulation_voice_cache_service on simulation_voice_cache;
create policy simulation_voice_cache_service on simulation_voice_cache
  for all to service_role
  using (true) with check (true);

comment on table simulation_voice_cache is
  'LLM-generated ticket bodies, keyed by (seed, sim_day, sim_hour, persona_id). Pre-populated at startAB so A/B policies share bodies — kills multiplicative LLM cost + sampling variance (PR #380).';
