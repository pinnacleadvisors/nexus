# 010 — Decline the Graphify + Obsidian dual-store for agent memory

- **Date:** 2026-05-30
- **Status:** Accepted

## Context

The operator researched a "dual-store cognitive architecture" — Graphify (a CLI
that compiles a codebase/markdown vault into a structural knowledge graph) +
Obsidian (human-editable markdown + backlinks) as a *declarative* store, paired
with a Postgres graph (referred to as "hmem") as a *transactional* event store —
and asked whether Nexus should combine the two for "best of both worlds":
human-auditable markdown **and** an automated graph DB.

The premise is sound. The question is whether adopting Graphify+Obsidian adds
anything Nexus's memory layer doesn't already provide.

## Decision

**Decline.** Nexus already runs exactly this dual-store architecture under
different names:

- **Human-readable / declarative half** = `pinnacleadvisors/memory-hq` — a git
  repo of one-fact-per-file markdown atoms/entities/MOCs with `[[wikilinks]]`,
  fully human-editable and version-controlled (the Obsidian role).
- **Graph-DB / transactional half** = the Supabase `mol_*` mirror — pgvector +
  full-text search + `mol_edge` + `mol_temporal_node` (H-Mem, `task_plan-hmem-
  architecture.md`), traversed by `/api/memory/walk` (the Postgres-graph role).

Crucially, the two are kept consistent **one-way** (markdown → DB) by
`app/api/cron/sync-memory/route.ts` with a reconcile replay. This is *safer*
than a true dual-**write** store: there is exactly one source of truth
(memory-hq), so the two halves cannot silently diverge — the failure mode a
naive dual-store reintroduces. Graphify's headline feature (auto-wiring edges
from content) already exists as the `hmem-extract-edges` cron + the
`/memory/pending-edges` approval gate.

Alternatives considered: (a) adopt Graphify as the graph compiler — rejected, it
duplicates `mol_edge` + the sync cron; (b) adopt Obsidian as the editor —
rejected, memory-hq markdown already opens in any Obsidian vault unchanged.

## Consequences

- **Easier:** no new infra, no dual-write divergence risk, no second vendor.
  Effort is freed for the two *real* H-Mem gaps the operator's "Akashic Record"
  ask actually maps to — the structural ecosystem graph (Thread A) and audit
  observability (Thread B, shipped) of `task_plan-2026-05-30-brain-dump.md`.
- **Harder:** none — capability parity already holds.
- **Revisit when:** if a graph-native store (Neo4j/AGE/Graphify) is ever
  genuinely wanted, A/B it through the existing `gbrain-bench` harness
  ([ADR 009](009-gbrain-evaluation.md)) against memory-hq on the 50-question
  multi-hop suite — measure, don't integrate blind.
