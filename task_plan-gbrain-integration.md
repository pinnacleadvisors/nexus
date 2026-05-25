# task_plan-gbrain-integration.md

> **Architectural overlay:** GBrain plugs into the [`memory` ecosystem kind](task_plan-departments-and-ecosystems.md#part-2--ecosystems-the-adapter-layer). v1 ships a stub `lib/ecosystems/adapters/gbrain.ts` that no-ops when `GBRAIN_BASE_URL` is unset — so the platform is shipped GBrain-ready before GBrain itself is wired. When the benchmark below picks GBrain over memory-hq for a specific business or department, the operator rebinds `memory` → `gbrain` with one DB update.

Goal: Evaluate and (if it wins on a head-to-head benchmark) integrate GBrain — Garry Tan / YC's self-wiring memory layer for AI agents — alongside (not replacing) the existing memory-hq stack. Result is either (a) a `lib/memory/gbrain.ts` adapter making GBrain queryable through the same MCP surface, or (b) a decision memo explaining why memory-hq plus the planned H-Mem evolution dominate for our workloads.

Sources:
- https://www.marktechpost.com/2026/05/22/a-step-by-step-coding-tutorial-to-implement-gbrain-the-self-wiring-memory-layer-built-by-y-combinators-garry-tan-for-ai-agents/
- https://github.com/garrytan/gbrain (status: assumed public per the tutorial — verify in Phase 1).

Success criteria:
- A documented decision: integrate, defer, or reject. Either way → one memory-hq atom captures the conclusion with reasoning.
- If integrate: a shim in `lib/memory/gbrain.ts` that lets `solopreneur-loop` and `business-operator` query GBrain through the same `memory_query` shape used today.
- If defer/reject: an entry in `docs/adr/` so the question doesn't get re-litigated in 6 weeks when GBrain trends again.

Hard constraints:
- Memory-hq is the authoritative store. Any new layer is ADDITIVE — never owns canonical writes alone.
- Self-wiring claims must be benchmarked, not believed. We're spending Claude tokens on inference loops; "self-wires automatically" can mean "burns a lot of tokens automatically".

---

## Phase 1 — Explore (NOT skipped — this is mostly research)

Run these in parallel; each is a separate sub-task.

1. **Repo recon.** Clone `garrytan/gbrain`; confirm license is permissive (MIT/Apache). Read the README, run the canonical example end-to-end in a fresh sandbox under [`services/nexus-sandbox/`](services/nexus-sandbox/). Capture (a) actual install command, (b) actual runtime requirements (Postgres? local file store? GPU?), (c) actual API surface.
2. **Tutorial replication.** Step through the marktechpost tutorial. Note every place its claims diverge from the README. The tutorial is younger than the repo — assume drift.
3. **Comparison axes (compile, don't decide).** For each of memory-hq, `mol_*`-mirrored molecular memory, and GBrain — fill the table:

   | Axis | memory-hq | molecular (current) | GBrain (after recon) |
   |---|---|---|---|
   | Write latency | | | |
   | Cross-project query | yes | no | TBD |
   | Self-wiring (auto-linking) | no | partial (lint) | claim: yes |
   | Provenance (author/kind/importance) | strong | strong | TBD |
   | Storage backend | GitHub + Supabase mirror | repo files | TBD |
   | Token cost per write | ~free | ~free | TBD — measure |
   | Token cost per query | ~free | ~free | TBD — measure |

4. **Token measurement.** Plug a Claude prompt with a fixed task into both memory-hq's `memory_search` AND GBrain's query API. Record total Anthropic token spend per task across 50 trials. The "self-wiring" claim is only valuable if the per-task spend stays in line with our current cost-guard targets.

## Phase 2 — Plan (post-recon)

If GBrain wins on the benchmark:

### Integration shape

- New file: `lib/memory/gbrain.ts` exposing `gbrainQuery({ scope, text, k })` returning `MemoryResult[]` — same shape as `memory_search` in `services/mcp-memory/`.
- New MCP tool `gbrain_query` registered in `services/mcp-memory/src/index.ts` so agents can call it like any other memory tool.
- New atom-kind: `kind: 'gbrain-suggested-link'` — when GBrain suggests an edge between two memory-hq atoms, we DON'T auto-write it; we file an `operator_tasks` row asking the operator to confirm. Avoids unbounded auto-mutation of the canonical store.
- One env var: `GBRAIN_BASE_URL` (+ optional `GBRAIN_API_KEY` if hosted). Falls back to a no-op tool when unset (so the platform still builds without GBrain).

### Cron sync

- `app/api/cron/gbrain-sync/route.ts` — once per 6h, walks new atoms in memory-hq and feeds them into GBrain so its graph reflects our canonical store. ONE-WAY sync — never the reverse.

### Approval gate

No new gate. The "convert GBrain suggestion to a real edge" workflow rides on the existing manual-task pattern.

If GBrain loses the benchmark:

- Write a single ADR (`docs/adr/0XX-gbrain-evaluation.md`) recording the test conditions, the numbers, and the decision.
- Write one memory-hq atom (`kind:decision, importance:high, links: [[mocs/memory-evaluation]]`) so future agents querying "should we adopt GBrain?" find the answer instantly.

## Phase 3 — Implement (only if GBrain wins)

1. Sandbox installation reproducible via a script in `scripts/install-gbrain-sandbox.mjs` (PR 1).
2. `lib/memory/gbrain.ts` + the MCP registration (PR 2).
3. Cron sync route + idempotency guard (PR 3).
4. ADR + memory-hq atoms documenting the integration (PR 4).
5. Runbook (`docs/runbooks/gbrain.md`) covering: when to use vs memory-hq, kill switch (`GBRAIN_BASE_URL=`).

## Risks / red flags to watch for during recon

- "Self-wiring" frequently means "LLM-mediated linking on every write" → cost grows with write volume. Measure.
- A claim of "no overhead" usually fails the Composio-style scope test — does GBrain partition by `business_slug` natively? If not, our multi-tenant model needs a wrapper.
- The marktechpost tutorial uses a small toy dataset. Reproduce with ≥ 1k atoms before drawing conclusions.

## Open questions

- Does GBrain expose a streaming API or only batch? Streaming determines whether it fits inside our 10s API routes.
- Can GBrain run on the same KVM4 host without a GPU? If not, this becomes a per-business container concern.
- Does it have any RLS/auth model, or does the calling service have to enforce ownership? If the latter, every `gbrainQuery` call from an API route must inject `user_id`/`business_slug` as a filter — mirror the [`lib/views/tasks.ts`](lib/views/tasks.ts) pattern.
