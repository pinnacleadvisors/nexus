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
│   ├── SUMMARY.md        ← one-liner per phase (1–22) with ✅/⬜ status  (~400 tokens)
│   └── PENDING.md        ← all not-started items grouped by phase
└── docs/
    ├── agents-guide.md   ← full AGENTS.md
    ├── readme.md         ← full README.md
    ├── roadmap-full.md   ← full ROADMAP.md  (~5000 tokens — avoid unless essential)
    └── claude-md.md      ← full CLAUDE.md
```

## Token-Efficient Query Flow

**Always follow this order — the wrong order wastes 10× the tokens:**

1. **Read `meta/INDEX.md` first** (~400 tokens) — tells you exactly which 1–2 files you need
2. **Read only those files** — never read `docs/roadmap-full.md` when `roadmap/SUMMARY.md` has the answer
3. **Use `meta/GRAPH.md`** only if you need to discover related files

## Reading from nexus-memory

`GITHUB_MEMORY_TOKEN` lives in Doppler. Prefix every command with `doppler run --` to inject it.

```bash
# Template — replace the path at the end
doppler run -- bash -c '
  curl -s -H "Authorization: token $GITHUB_MEMORY_TOKEN" \
    "https://api.github.com/repos/pinnacleadvisors/nexus-memory/contents/meta/INDEX.md" \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); print(base64.b64decode(d[\"content\"].replace(\"\\n\",\"\")).decode())"
'
```

**Common reads** — swap the path in the template above:

| What you need | Path |
|---------------|------|
| Topic map (start here) | `meta/INDEX.md` |
| Stack & dev rules | `platform/STACK.md` |
| All phase statuses | `roadmap/SUMMARY.md` |
| What needs building | `roadmap/PENDING.md` |
| All env vars | `platform/SECRETS.md` |
| File structure / API patterns | `platform/ARCHITECTURE.md` |

## Writing to nexus-memory

### Option A — memory-queue/ (preferred for targeted updates)

Drop a `.md` file with YAML frontmatter into `memory-queue/`, then run the populator. The script handles base64 encoding, SHA retrieval, and deletes the file after writing.

```bash
# 1. Create the queue file
cat > memory-queue/update-roadmap.md << 'EOF'
---
memory_path: roadmap/SUMMARY.md
memory_mode: write
---
# Nexus — Roadmap Summary
...updated content...
EOF

# 2. Process the queue (writes to nexus-memory, deletes queue file)
doppler run -- node scripts/populate-memory.mjs
```

`memory_mode`:
- `write` — replaces entire file
- `append` — appends to end of existing content

### Option B — Full repopulate (after source doc changes)

Rebuilds all nexus-memory files from `ROADMAP.md`, `AGENTS.md`, `CLAUDE.md`, etc.:

```bash
doppler run -- node scripts/populate-memory.mjs
```

Use this when multiple platform files changed, not for single targeted updates.

### Option C — Direct API write (single file, no queue)

```bash
doppler run -- bash -c '
  SHA=$(curl -s -H "Authorization: token $GITHUB_MEMORY_TOKEN" \
    "https://api.github.com/repos/pinnacleadvisors/nexus-memory/contents/roadmap/SUMMARY.md" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[\"sha\"])")

  CONTENT=$(printf "%s" "# New content here" | base64 -w0)

  curl -s -X PUT \
    -H "Authorization: token $GITHUB_MEMORY_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.github.com/repos/pinnacleadvisors/nexus-memory/contents/roadmap/SUMMARY.md" \
    -d "{\"message\":\"update SUMMARY.md\",\"content\":\"$CONTENT\",\"sha\":\"$SHA\"}"
'
```

## When to Update nexus-memory

After implementing a feature or discovering a pattern, update if:
- Feature status changed → `roadmap/SUMMARY.md` + `roadmap/PENDING.md`
- New dev rules emerged → `platform/STACK.md`
- Architecture changed → `platform/ARCHITECTURE.md`
- New env vars added → `platform/SECRETS.md`
- New relationships → add edges to `meta/GRAPH.md`

**Always write dense summaries, not full docs** — chunk by concern, precompute relationships.

## Doppler Setup (first-time)

If `doppler run --` fails with "not configured", run:

```bash
doppler setup   # select project: nexus, config: dev
```

Requires Doppler CLI installed (`brew install dopplerhq/cli/doppler` or `npm install -g @dopplerhq/cli`) and a Doppler account with access to the `nexus` project.
