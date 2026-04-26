---
type: moc
title: "Sub-Plan — Roadmap → Molecular Memory split"
id: roadmap-split-sub-plan
created: 2026-04-26
sources:
  - task_plan.md#L414
links:
  - "[[task-r1-confirm-molecular-dirs]]"
  - "[[task-r2-r23-phase-mocs]]"
  - "[[task-r24-r5x-pending-atoms]]"
  - "[[task-r-graph-rebuild-adjacency]]"
  - "[[task-r-reindex-molecular]]"
  - "[[task-r-protocol-claudemd-update]]"
  - "[[task-r-header-roadmap-breadcrumb]]"
---

# Sub-Plan — Roadmap → Molecular Memory split

Replace bulk reads of `ROADMAP.md` (917 lines / ~19k tokens) with token-efficient
`molecularmemory_local` queries. After user approval the scope expanded to three
namespaces: `memory/roadmap/molecular/`, `memory/integration/molecular/`,
`memory/tasks/molecular/` — the latter is this namespace.

## Tasks
- [[task-r1-confirm-molecular-dirs]] — `cli.mjs init` for the namespace
- [[task-r2-r23-phase-mocs]] — One MOC per ROADMAP phase (22 total)
- [[task-r24-r5x-pending-atoms]] — Atom per pending bullet + design decision
- [[task-r-graph-rebuild-adjacency]] — `cli.mjs graph` rebuild
- [[task-r-reindex-molecular]] — `cli.mjs reindex` regenerate INDEX.md
- [[task-r-protocol-claudemd-update]] — Tell agents to query molecular first
- [[task-r-header-roadmap-breadcrumb]] — Insert agent breadcrumb at top of `ROADMAP.md`

## Related
- [[ecosystem-a-pack]]
- [[ecosystem-b-pack]]
- [[ecosystem-c-pack]]
