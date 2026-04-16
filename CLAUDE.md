@AGENTS.md

---

# nexus-memory Integration

## Knowledge Base Structure

All platform knowledge is stored in the private repository **`pinnacleadvisors/nexus-memory`** using a **Graphify-style** structure: chunked by concern, precomputed relationships, dense summaries — designed so you can get full context in 1–2 reads instead of scanning whole documents.

### Directory Structure

```
nexus-memory/
├── meta/
│   ├── INDEX.md          ← START HERE — topic→file map, all topics listed
│   └── GRAPH.md          ← precomputed relationship edges between files
├── platform/
│   ├── STACK.md          ← ALL dev rules (Next.js 16, Tailwind 4, Clerk v7, AI SDK 6, icons)
│   ├── ARCHITECTURE.md   ← file structure, API patterns, DB access
│   ├── SECRETS.md        ← every env var by phase, with where to get it
│   └── OVERVIEW.md       ← what Nexus is, all pages, design principles
├── roadmap/
│   ├── SUMMARY.md        ← one-liner per phase (1–22) with ✅/⬜ status
│   └── PENDING.md        ← all not-started items grouped by phase
└── docs/
    ├── agents-guide.md   ← full AGENTS.md
    ├── readme.md         ← full README.md
    ├── roadmap-full.md   ← full ROADMAP.md
    └── claude-md.md      ← full CLAUDE.md
```

## How to Use nexus-memory

### Query Flow (Token-Efficient)

1. **Start with meta/INDEX.md** — small file listing which topics are in which files
2. **Read the specific file(s)** — dense, precomputed summaries on that concern
3. **Use meta/GRAPH.md** — discover related files if needed

This mirrors Graphify's **single-call context retrieval** — instead of reading entire ROADMAP.md (5000 tokens), read `roadmap/SUMMARY.md` (400 tokens).

### Available Queries

Use the Doppler-configured `GITHUB_MEMORY_TOKEN` to fetch:

```bash
# Get the topic map
curl -H "Authorization: token $GITHUB_MEMORY_TOKEN" \
  https://api.github.com/repos/pinnacleadvisors/nexus-memory/contents/meta/INDEX.md

# Get stack rules
curl -H "Authorization: token $GITHUB_MEMORY_TOKEN" \
  https://api.github.com/repos/pinnacleadvisors/nexus-memory/contents/platform/STACK.md

# Get roadmap summary
curl -H "Authorization: token $GITHUB_MEMORY_TOKEN" \
  https://api.github.com/repos/pinnacleadvisors/nexus-memory/contents/roadmap/SUMMARY.md
```

## Updating nexus-memory After Changes

### When to Update

After implementing a feature, fixing a bug, or discovering a pattern, **update nexus-memory** if:
- New dev rules or conventions emerged
- Stack or architecture changed
- Feature status changed (update `roadmap/SUMMARY.md` and `roadmap/PENDING.md`)
- New relationships between concerns exist (add edges to `meta/GRAPH.md`)

### Update Pattern (Graphify)

Use the `claude/nexus-memory-integration-jXmrB` branch pattern:

1. **Identify the file(s) to update** — use meta/INDEX.md + meta/GRAPH.md to locate
2. **Dense summaries, not full docs** — chunk by concern, precompute relationships
3. **Update meta/GRAPH.md** — add/remove edges as dependencies shift
4. **Commit + push to `pinnacleadvisors/nexus-memory`**

Example: After adding a new phase or feature:
- Update `roadmap/SUMMARY.md` with one-liner + status
- Update `roadmap/PENDING.md` to move item to done/in-progress
- Update `meta/GRAPH.md` if the new feature relates to other concerns

### Running the Populator

To rebuild nexus-memory from source (after major updates):

```bash
npm run populate-memory
```

Uses Doppler for `GITHUB_MEMORY_TOKEN` + `GITHUB_MEMORY_REPO` env vars.
