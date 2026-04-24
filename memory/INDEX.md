# Platform Memory — Index

> **Read this first (~500 tokens). Then read only the 1–2 files you actually need.**
>
> `memory/` is Nexus's canonical context base. It uses a **3-layer architecture** inspired by Felixcraft.ai / Nat Eliason's OpenClaw framework — layers separated by volatility. Every agent session loads Layer 1 automatically, queries Layer 2 on-demand, and writes back to Layer 2/3 as work completes.

## 3-Layer memory architecture

| Layer | Name | Volatility | Purpose | Location |
|-------|------|------------|---------|----------|
| **1** | Project Brief (stable) | Rarely changes | Persistent rules, protocols, stack decisions, product definition | `memory/platform/*.md`, `CLAUDE.md`, `AGENTS.md`, `docs/adr/` |
| **2** | Project State (living) | Evolves across sessions | Roadmap status, active long-horizon plan, per-run state, domain knowledge graph | `memory/roadmap/*.md`, `task_plan.md`, `memory/runs/`, `memory/molecular/` |
| **3** | Session Memory (volatile) | Current chat only | Scratch decisions, open questions, in-flight context | Chat context — promoted to Layer 2 via `/molecularmemory_local atom` or a Progress update |

**Promotion protocol (COPY → VERIFY → DELETE):** a Layer-3 fact becomes durable by writing it to Layer 2 (an atom, an entity, a Progress section), re-reading the written file to confirm, then dropping it from scratch. Never let a durable decision live only in chat context.

## Layer 1 — Project Brief (stable)

| Topic | File | When to read |
|-------|------|--------------|
| Dev rules (Next.js 16, Tailwind 4, AI SDK 6, icons, TypeScript) | `platform/STACK.md` | Before writing any code |
| File structure, API patterns, component placement, DB access | `platform/ARCHITECTURE.md` | Before adding routes or components |
| Every env var by phase, where to get each one | `platform/SECRETS.md` | Before configuring any service |
| What Nexus is, all pages, design principles | `platform/OVERVIEW.md` | When you need product context |
| Agent protocols (managed agents, n8n strategist, review loop) | `../AGENTS.md` | Before creating or invoking agents |
| Architectural decisions (why we chose X over Y) | `../docs/adr/INDEX.md` | Before re-litigating a past choice |

## Layer 2 — Project State (living)

| Topic | File | When to read |
|-------|------|--------------|
| Phase 1–22 status (one-liner each) | `roadmap/SUMMARY.md` | Before planning feature work |
| All ⬜ not-started items grouped by phase | `roadmap/PENDING.md` | Finding what to build next |
| Self-Optimising Ecosystem plan + progress (Pillars A/B/C) | `../task_plan.md` | Resuming long-horizon work |
| Per-run snapshots (mirrored from Supabase `runs` table) | `runs/<run-id>.md` | Resuming a specific idea→launch chain |
| Domain knowledge graph — atoms, entities, MOCs | `molecular/INDEX.md` | Answering "what do we know about X?" |

## Layer 3 — Session memory (volatile)

Held in chat context. Before a session ends, promote durable facts:

- **Atomic fact** → `node .claude/skills/molecularmemory_local/cli.mjs atom "<title>" --fact="..." --source=<ref>`
- **Entity (person/company/concept)** → `cli.mjs entity <type> "<name>"`
- **Multi-step task progress** → edit `task_plan.md` `## Progress` section
- **Architectural decision** → write an ADR (`docs/adr/NNN-title.md`)
- **Roadmap status change** → edit `roadmap/SUMMARY.md` + `roadmap/PENDING.md`

## Query flow (saves 10× tokens vs scanning source docs)

1. Read `memory/INDEX.md` (this file) — identify which 1–2 files you need
2. Read only those files
3. If the task touches domain knowledge, open `memory/molecular/INDEX.md` → follow `[[wikilinks]]` from the relevant MOC
4. Use `memory/GRAPH.md` to discover related files
5. Fall back to Grep/Glob only for areas the graphs don't cover

## Graph

See `GRAPH.md` for dependency edges between memory files.

## Related files in repo

These are the authoritative sources — memory files are dense summaries of them:

| Source | Memory equivalent |
|--------|------------------|
| `AGENTS.md` | `platform/STACK.md` + `platform/ARCHITECTURE.md` |
| `ROADMAP.md` | `roadmap/SUMMARY.md` + `roadmap/PENDING.md` |
| `CLAUDE.md` | — (read directly, it's short) |
| Supabase `runs` table | `runs/<run-id>.md` snapshots (future cache) |

## Keeping memory current (the write path)

After completing a feature, edit the relevant file with a plain `Edit` — no scripts, no API calls:

- **Feature status changed** → `roadmap/SUMMARY.md` + `roadmap/PENDING.md`
- **New dev rule discovered** → `platform/STACK.md`
- **New route / component / lib file** → `platform/ARCHITECTURE.md`
- **New env var added** → `platform/SECRETS.md`
- **Durable fact about the domain** → `molecular/` via the cli
- **Long-horizon task progress** → `task_plan.md` `## Progress`

Always write dense summaries — never duplicate full source docs.
