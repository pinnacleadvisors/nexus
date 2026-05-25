# task_plan-hmem-architecture.md

Goal: Evolve memory-hq from a flat Layer-2c atomic-fact store into an H-Mem-style hybrid system — a Temporal-Semantic Tree on top of the atom store, plus a Knowledge Graph layered over the tree — so multi-hop, time-aware queries that today require multiple `memory_search` calls become a single traversal. Built incrementally on the existing `mol_*` Supabase mirror; the canonical GitHub repo at `pinnacleadvisors/memory-hq` stays untouched.

What H-Mem buys us (per the architecture comparison the operator pasted):
- **Native chronological consolidation** — short-term episodic memories compress into long-term summaries over time. We currently approximate this via cron'd `digest/<date>.md`; H-Mem makes it a first-class shape and a first-class query target.
- **Topological multi-hop reasoning** — explicit graph edges (`promoted_to`, `cancelled`, `caused_by`) traversed by the agent, not approximated by vector cosine.
- **Preference / state override** — newer episodic memories supersede older long-term summaries when they conflict.

Success criteria:
- A new `mol_temporal_node` table mirrors short→long-term compression. Cron-driven; idempotent.
- A new `mol_edge` table holds named graph edges. Existing `[[wikilinks]]` in atoms back-fill edges on insert.
- A new MCP tool `memory_walk` accepts a start node + a hop predicate (`['caused', 'affected']`) and returns the traversal path.
- An adversarial benchmark proves a measured improvement on a curated multi-hop question set vs the current `memory_search` baseline (target: ≥ 25% better on F1 for the 50 hand-crafted multi-hop questions).
- No regression in the existing `memory_search` / `memory_query` shape — H-Mem is ADDITIVE.

Hard constraints:
- Token budget per consolidation cycle ≤ 25k Anthropic tokens/day at our current ~200 atoms/week rate. Anything heavier needs cost-guard wiring per the [Operating principles](AGENTS.md#operating-principles-for-every-agent-read-first) — specifically `checkKillSwitch()` before each consolidation pass.
- The canonical memory-hq GitHub repo remains the source of truth for atoms, entities, MOCs. H-Mem tables in Supabase are derived state; a `npm run rebuild-hmem` script must be able to drop and recompute them from the repo in < 10 min.
- All H-Mem reads gate on the same `(user_id, scope)` filters as memory-hq — same multi-tenant model, same RLS posture.

---

## Phase 1 — Explore

- Read [`AGENTS.md` — Memory HQ section](AGENTS.md#post-incident-memory-protocol) and the cross-repo protocols in `~/.claude/CLAUDE.md`.
- Catalog current `mol_*` tables (atoms, entities, mocs, sources, synthesis, links). The new tables compose on top.
- Curate 50 multi-hop questions from real Nexus usage (incident postmortems, vendor histories, infrastructure changes) — this becomes the benchmark suite. Without it, "H-Mem is better" is unfalsifiable.
- Check the `digest/<YYYY-MM-DD>.md` cron output for what consolidation already does; H-Mem's temporal compression is roughly "do this on a node-by-node basis, not a day-by-day basis".

## Phase 2 — Plan (atomic tasks)

### New tables (migration ≥ 060)

```sql
create table mol_temporal_node (
  id            uuid primary key default uuid_generate_v4(),
  scope_id      text not null,                  -- 55bedf46-nexus, etc.
  level         smallint not null,              -- 0 = episodic (raw atom),
                                                 -- 1 = day-summary,
                                                 -- 2 = week-summary,
                                                 -- 3 = topic long-term
  parent_id     uuid references mol_temporal_node(id) on delete set null,
  source_atom_ids uuid[] not null,              -- the atoms this node summarises
  title         text not null,
  body          text not null,
  ts_start      timestamptz not null,
  ts_end        timestamptz not null,
  created_at    timestamptz not null default now(),
  superseded_by uuid references mol_temporal_node(id) on delete set null
);

create table mol_edge (
  id            uuid primary key default uuid_generate_v4(),
  scope_id      text not null,
  src_kind      text not null,                  -- 'atom' | 'entity' | 'temporal'
  src_id        uuid not null,
  predicate     text not null,                  -- 'caused', 'cancelled', 'promoted_to', 'mentions', ...
  dst_kind      text not null,
  dst_id        uuid not null,
  confidence    real not null default 1.0,      -- 0..1; LLM-extracted edges < 1.0
  source        text not null,                  -- 'wikilink' | 'llm' | 'operator'
  created_at    timestamptz not null default now()
);
```

Indexes: `(scope_id, src_id)`, `(scope_id, dst_id)`, `(scope_id, predicate)`.

### Pipelines

1. **Wikilink back-fill** — when an atom or MOC is mirrored from memory-hq, parse `[[...]]` references and INSERT edges with `source='wikilink', predicate='mentions', confidence=1.0`. Free, deterministic, runs on every mirror webhook.
2. **LLM edge extraction** — daily cron, walks new atoms with `kind:incident`/`kind:infra-change`, asks the LLM "name the causal/temporal edges between these entities" and INSERTs with `source='llm', confidence=<llm_score>`. Operator approves > 0.7 confidence edges with a batched `approval-request`; below threshold lives in a side table for review later.
3. **Temporal consolidation** — daily cron at 03:00 builds level-1 summaries (yesterday's episodic atoms → 1 summary node). Weekly cron builds level-2 from level-1. Monthly cron builds level-3 from level-2. Each level uses LLM compression with a fixed-shape prompt so outputs are predictable for the eval suite.
4. **Supersession** — when a new atom's body contains "previously X, now Y" patterns (rule-matched, not LLM-mediated to stay cheap), find the matching old level-3 node and set its `superseded_by` to the new chain. Queries default-filter out superseded nodes.

### New MCP tools (added in `services/mcp-memory/src/index.ts`)

- `memory_walk({ scope, start_id, predicates, max_hops })` → ordered path of `{ node, edge }` pairs.
- `memory_timeline({ scope, entity_id, since })` → ordered list of temporal nodes that mention the entity, newest first, with supersession applied.
- (existing) `memory_search` / `memory_query` unchanged.

### Migration backfill

One-time script: `scripts/hmem-backfill.mjs` reads every atom in the mirror and:
- Builds wikilink edges (fast, deterministic).
- Skips temporal consolidation (too expensive on history; we start fresh from today and consolidate forward).
- Logs a row in `migration_status` so we can resume on partial failure.

### Provider-agnostic check

Every prompt template in this pipeline lives in `lib/memory/hmem-prompts.ts` with no model pins in the prose. Switching `LLM_PROVIDER` swaps the model used for edge extraction + consolidation. The [`check:provider-agnostic`](AGENTS.md#pre-commit-checklist) script extends to scan that file.

## Phase 3 — Implement (incremental landings)

1. Add the two tables + indexes (PR 1, migration 060).
2. Wikilink back-fill in the mirror webhook (PR 2).
3. `memory_walk` + `memory_timeline` MCP tools (PR 3).
4. LLM edge extraction cron + approval shape (PR 4).
5. Temporal consolidation cron with cost-guard (PR 5).
6. Backfill script + a `scripts/eval-hmem.mjs` that runs the 50-question benchmark and exits non-zero on regression (PR 6).
7. Operator runbook (`docs/runbooks/hmem.md`).

## Comparison vs the existing memory landscape (for the decision memo)

| Capability | Today (memory-hq + mol_*) | Post-H-Mem |
|---|---|---|
| Atomic fact recall | strong | unchanged |
| Multi-hop "X caused Y caused Z" | weak — needs 3 `memory_search` calls | strong — `memory_walk` one call |
| Temporal "what changed last month" | medium — read `digest/` directory | strong — `memory_timeline` one call |
| Preference supersession | none — newer atom doesn't override older one | yes — `superseded_by` chain |
| Cost per write | ~free | +small (edge extraction batched) |
| Cost per consolidation | ~free | bounded by daily/weekly/monthly cron |
| Multi-tenant safety | strong | unchanged (same scope filters) |

## Risks

- **LLM-extracted edges drift the graph.** Mitigation: every LLM edge is `confidence < 1.0`, every `confidence > 0.7` edge gets operator approval before becoming queryable, edges below threshold are flagged in a side table.
- **Cost overrun in consolidation.** Mitigation: kill-switch check before every cron firing; ~25k token/day target documented in `SECRETS.md`.
- **Supersession false positives.** Rule-matched only (not LLM-mediated) → tractable to audit. Operator can revert via a `memory_atom` write that re-asserts the old fact.

## Open questions

- How are entity ids tied across `atom → entity → temporal_node`? Decision: entity is the stable id; atoms and temporal nodes carry an `entity_id[]` array. Settled in Phase 1.
- Should `memory_walk` accept negative-predicate filters ("anything but `mentions`")? Defer until a real query needs it.
- Should the GitHub repo at `pinnacleadvisors/memory-hq` get edge YAML files too, or do edges only live in Supabase? Settled: Supabase-only. The repo stores facts; edges are derived state.
