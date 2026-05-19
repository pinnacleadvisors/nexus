---
type: atom
title: "Lean-mode pivot via feature flag not branch fork (Nexus pattern)"
id: lean-mode-pivot-via-feature-flag-not-branch-fork-nexus-pattern
created: 2026-05-19
links:
  - "[[agent-framework-survey]]"
status: active
lastAccessed: 2026-05-19
accessCount: 0
---

# Lean-mode pivot via feature flag not branch fork (Nexus pattern)

2026-05-19 — Nexus pivoted from multi-tenant production shape to lean solo-dev shape. Decision: preserve scale-mode via LEAN_MODE feature flag in lib/lean-mode.ts, NOT a lean-dev branch. Reason: a branch diverges, then merging multi-tenant scaffolding back costs more than the original work. Git-tagged v1.0-multi-tenant as the snapshot; every multi-tenant boundary (provisioning, scale-down cron, cost-guard, Composio resolution, future Stripe attribution) short-circuits when isLeanMode() returns true. See docs/adr/006-lean-mode-pivot.md.

## Related
- [[agent-framework-survey]]
