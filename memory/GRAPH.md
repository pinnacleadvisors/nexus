# Platform Memory — Graph

Edges: A → B means "reading A often requires also reading B"

```
INDEX.md ──────────→ platform/*.md        (layer 1 catalog)
INDEX.md ──────────→ roadmap/*.md         (layer 2 catalog)
INDEX.md ──────────→ molecular/INDEX.md   (domain knowledge entry)

STACK.md ──────────→ ARCHITECTURE.md      (stack rules reference specific file paths)
ARCHITECTURE.md ───→ SECRETS.md           (API routes reference env vars)
OVERVIEW.md ───────→ STACK.md             (product context implies stack constraints)

roadmap/SUMMARY.md → roadmap/PENDING.md   (summary items link to pending detail)
roadmap/SUMMARY.md → ../task_plan.md      (SOE phase tracks in task_plan)

molecular/INDEX.md → molecular/mocs/      (start at a MOC)
molecular/mocs/    → molecular/atoms/     (MOC fans out to atoms)
molecular/mocs/    → molecular/entities/  (MOC references entity notes)
molecular/mocs/    → molecular/sources/   (MOC's "## Sources" lists ingested docs)
molecular/mocs/    → molecular/synthesis/ (MOC's "## Synthesis" lists filed Q&A)
molecular/atoms/   → molecular/entities/  (atoms cite entities via [[wikilinks]])
molecular/atoms/   → molecular/sources/   (atom's source: points to a sources/ page)
molecular/log.md   ←  cli.mjs ingest/synthesis/lint (append-only)
```

## High-value starting points by task type

| Task | Start here |
|------|-----------|
| Adding a new page/route | `platform/ARCHITECTURE.md` → `platform/STACK.md` |
| Configuring a new service | `platform/SECRETS.md` |
| Planning a feature | `roadmap/SUMMARY.md` → `roadmap/PENDING.md` |
| Resuming long-horizon work (Pillars A/B/C) | `../task_plan.md` → `roadmap/SUMMARY.md` (SOE table) |
| Writing any component | `platform/STACK.md` |
| Understanding the product | `platform/OVERVIEW.md` |
| Answering "what do we know about X?" | `molecular/INDEX.md` → relevant MOC |
| Adding a durable fact or decision | `node .claude/skills/molecularmemory_local/cli.mjs atom ...` |
