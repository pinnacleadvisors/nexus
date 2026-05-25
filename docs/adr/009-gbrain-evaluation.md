# ADR 009 — GBrain evaluation: gate the integration on a measured benchmark

**Status:** proposed (recon ships v1; integration decision waits on benchmark numbers)
**Date:** 2026-05-25
**Plan:** [task_plan-gbrain-integration.md](../../task_plan-gbrain-integration.md)

## Context

GBrain — Y Combinator / Garry Tan's self-wiring memory layer — claims native multi-hop reasoning + automatic edge extraction over traditional vector RAG. The user asked whether to integrate it alongside our memory-hq stack.

Two failure modes we explicitly want to avoid:
1. **Adopt by hype.** "Self-wiring" sounds great until "self-wiring on every write" turns out to mean "LLM call on every write" — which would blow our cost-guard budgets.
2. **Reject by inertia.** memory-hq is the canonical store, but if GBrain's multi-hop traversal genuinely answers questions our current `memory_search` can't, defaulting to "stay" denies the platform a real capability gain.

## Decision

Build the eval primitives first. **Integrate or reject AFTER a head-to-head benchmark on real questions**, not before.

What ships in v1 (this PR):
- [`scripts/install-gbrain-sandbox.mjs`](../../scripts/install-gbrain-sandbox.mjs) — reproducible local install in `services/nexus-sandbox/gbrain/`.
- [`tests/memory/multi-hop-questions.json`](../../tests/memory/multi-hop-questions.json) — 50 questions drawn from real Nexus platform history (incidents, infra changes, decisions, env-var rotations). Each requires ≥ 2 hops to answer.
- [`scripts/eval-memory.mjs`](../../scripts/eval-memory.mjs) — runs the benchmark against either memory-hq or GBrain. v1 grading is a substring-citation check (does the answer mention the expected atom slugs?). Records latency p50 / p95 + error count.
- [`lib/ecosystems/adapters/gbrain.ts`](../../lib/ecosystems/adapters/gbrain.ts) — already shipped in v1 as a verb router; THIS PR turns it into a real HTTP client.

The decision gates land AFTER the operator runs the benchmark on both adapters and records the numbers in this file (the "Results" section below).

## Decision criteria

| Criterion | Memory-hq must beat | GBrain must beat | Notes |
|---|---|---|---|
| Citation score | baseline | ≥ +25% over memory-hq | The "GBrain is genuinely better at multi-hop" threshold. < 25% = no real signal. |
| p95 latency | < 1500 ms | < 3000 ms | GBrain's traversal is more expensive but must stay inside the 10s API route ceiling with margin. |
| Per-task token cost | (baseline ~free) | ≤ 2 k Anthropic tokens / question | "Self-wiring" mustn't burn our cost-guard. |
| Stability | 0 errors / 50 | ≤ 2 errors / 50 | GBrain is new; some flakiness is acceptable, large flakiness isn't. |

If GBrain meets all four: integrate. The adapter stub becomes a real HTTP client (already wired this PR); operator can rebind `memory:gbrain` per business via the existing rebind UI.

If GBrain misses any: write the numbers into the Results section below, keep the stub adapter (so the abstraction stays right), revisit when a major GBrain release ships.

## Out of scope for the eval

- **NLP grading.** v1 uses citation-substring matching. Real "did the answer make sense?" grading needs a third model + a rubric, which is a 5x complexity increase for a question we can answer with substring.
- **Cross-project queries.** We bench in `55bedf46-nexus` scope only. If GBrain wins there, we extend to other scopes; if it loses there, no point testing further.
- **Write-path comparison.** v1 measures READ performance. Write costs are estimated separately (the recon's per-task token measurement).

## Results (to fill in after recon)

```
Date: <YYYY-MM-DD>
Run command: node scripts/eval-memory.mjs <adapter> --json > <adapter>-results.json

memory-hq:
  avg citation score: __%
  p50 latency:        __ ms
  p95 latency:        __ ms
  errors:             __ / 50

gbrain:
  avg citation score: __%
  p50 latency:        __ ms
  p95 latency:        __ ms
  errors:             __ / 50

Decision: <integrate | defer | reject>
Rationale: <one paragraph>
```

## Status transitions

- `proposed` (now) — eval primitives shipping; numbers not yet collected.
- `accepted` — operator ran the bench, numbers recorded, decision documented.
- `superseded` — another memory ecosystem (mem0, Letta, H-Mem mature) wins instead.

## Linked

- [task_plan-gbrain-integration.md](../../task_plan-gbrain-integration.md)
- [task_plan-hmem-architecture.md](../../task_plan-hmem-architecture.md) — H-Mem is the in-house alternative; if it matures faster, GBrain integration becomes moot.
- [task_plan-departments-and-ecosystems.md](../../task_plan-departments-and-ecosystems.md) — both memory-hq and GBrain are `memory` kind adapters; the rebind UI handles the swap mechanically.
