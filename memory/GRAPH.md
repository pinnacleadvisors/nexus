# Platform Memory — Graph

Edges: A → B means "reading A often requires also reading B"

```
STACK.md ──────────→ ARCHITECTURE.md   (stack rules reference specific file paths)
ARCHITECTURE.md ───→ SECRETS.md        (API routes reference env vars)
OVERVIEW.md ───────→ STACK.md          (product context implies stack constraints)
roadmap/SUMMARY.md → roadmap/PENDING.md (summary items link to pending detail)
```

## High-value starting points by task type

| Task | Start here |
|------|-----------|
| Adding a new page/route | `platform/ARCHITECTURE.md` → `platform/STACK.md` |
| Configuring a new service | `platform/SECRETS.md` |
| Planning a feature | `roadmap/SUMMARY.md` → `roadmap/PENDING.md` |
| Writing any component | `platform/STACK.md` |
| Understanding the product | `platform/OVERVIEW.md` |
