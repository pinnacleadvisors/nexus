---
type: atom
title: "A7 — Graph-keyed context retrieval for Queen"
id: task-a7-graph-keyed-context
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L127
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a7]]"
---

# A7 — Graph-keyed context retrieval for Queen

New `lib/swarm/GraphRetriever.ts` plus edits to `lib/swarm/TokenOptimiser.ts`. Before
calling Claude, query `/api/graph/query` with role + keywords from the goal, fetch
only relevant atoms + entity summaries, and build a budget-aware prompt capped at
12k retrieved-context tokens. Falls back to `buildSwarmContext` when the graph
query is empty. Emits `graph.retrieved` event with node IDs.

Verify: p50 input tokens drop ≥40% on a canned 5-task swarm; unit test asserts ≤12k tokens.

## Related
- [[ecosystem-a-pack]]
