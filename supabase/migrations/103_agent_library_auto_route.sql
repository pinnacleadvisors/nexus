-- 103 — agent_library.auto_route: opt-in dispatch-time smart model routing.
--
-- When auto_route=true AND the agent has no stored model + no per-turn override,
-- the dispatch resolver (lib/ai/dispatch.ts) asks the (24h-cached) model
-- recommender to pick the best model+provider for the agent's job before the
-- chain proceeds. Default false — zero behaviour change for every existing
-- agent; the cheap-eval hop only fires for agents the operator explicitly opts
-- in (h4 trajectory regulation, ship-as-opt-in per the providers-routing plan).
--
-- Idempotent.

alter table agent_library
  add column if not exists auto_route boolean not null default false;

comment on column agent_library.auto_route is
  'Opt-in: when true + no stored/per-turn model, dispatch asks the cached '
  'recommender to pick the model. Default false (no behaviour change).';
