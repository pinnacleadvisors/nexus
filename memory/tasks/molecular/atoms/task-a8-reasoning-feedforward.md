---
type: atom
title: "A8 — ReasoningBank feedforward"
id: task-a8-reasoning-feedforward
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L133
links:
  - "[[ecosystem-a-pack]]"
  - "[[progress-ecosystem-a8]]"
lastAccessed: 2026-04-26
accessCount: 0
---

# A8 — ReasoningBank feedforward

Edit `lib/swarm/ReasoningBank.ts` and `lib/swarm/Queen.ts`: `strategicDecompose`
loads top-k past successful decompositions for similar goals (cosine on goal
embedding) and includes the shortest one as a few-shot example. When a run reaches
`done`, write the plan back to ReasoningBank with outcome metrics. Plan patterns
stored via `migrations/016_plan_patterns.sql`.

Verify: second similar-goal run references the prior plan in its output.

## Related
- [[ecosystem-a-pack]]
