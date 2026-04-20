@AGENTS.md

---

# Long-Horizon Task Protocol

Long-running or multi-session tasks on this brownfield codebase follow a strict 4-step workflow. **Never jump straight to implementation.**

## Step 0 — North Star (always first)

Before any exploration, write three lines at the top of `task_plan.md`:
```
Goal: <one sentence>
Success criteria: <bullet list of verifiable outcomes>
Hard constraints: <what must not break>
```
Every later decision checks back against these. If implementation drifts from them, stop and replan.

## Phase 1 — Explore

Map the surface area before touching any code:
- **Check the knowledge graph first**: if `graphify-out/GRAPH_REPORT.md` exists, read it — it maps god nodes, module communities, and dependency clusters so you navigate by structure instead of grepping every file
- Read entry points, interfaces, and all callers for the targeted code
- Identify hidden global state, environment assumptions, and implicit contracts
- Check for existing tests covering the area
- Record findings in `task_plan.md`

> If the graph is stale or missing, run `/graphify .` to rebuild it before searching.

## Phase 2 — Plan

Write or update `task_plan.md` before writing any implementation code. Use the **atomic task format** for each step:

```
### Task N — short title
- File: `path/to/file.ts` (line if known)
- Change: one sentence
- Verify: how to confirm it worked
- Parallel: yes / no
```

Tasks must be 2–5 minutes each. Group all `Parallel: yes` tasks and dispatch them to subagents simultaneously (see Parallel Dispatch below). Flag risks: breaking changes, invisible contracts, missing test coverage. **User must review the plan before Phase 3 begins.**

## Phase 3 — Implement

- For risky or exploratory changes, use a git worktree so the feature branch stays clean:
  ```bash
  git worktree add ../nexus-experiment feature/experiment-name
  # merge or cherry-pick back when proven
  ```
- TDD: write the failing test first, watch it fail, then implement minimally to pass (RED → GREEN → REFACTOR)
- Run `npx tsc --noEmit` after every significant change
- Never implement beyond what the plan specifies — open a follow-up task instead

### PDCA Enforcement Checkpoints

Pause at each gate and verify against the North Star before continuing:

| Checkpoint | Gate question |
|---|---|
| After Explore | Does the plan target the right code? Does scope match the North Star? |
| After each commit | Does this commit move measurably toward the success criteria? |
| After full implementation | Do all success criteria pass? |
| Before PR | Is the diff reviewable? Is the North Star achieved? |

If a gate fails, update `task_plan.md` and loop back — don't push forward.

## Parallel Subagent Dispatch

When `task_plan.md` contains tasks marked `Parallel: yes`, dispatch them together:
- Each subagent gets: its task spec, relevant file paths, and the North Star
- Run two-stage review after all agents return: (1) spec compliance, (2) code quality
- Merge results only after both stages pass

## Context Compaction (long or multi-day sessions)

When a session grows long, before it degrades:
1. Update `task_plan.md` with a `## Progress` section (see template below)
2. Commit: `git commit -m "chore: update task_plan progress"`
3. Start a fresh session — open `task_plan.md` to restore context instantly

```
## Progress (as of YYYY-MM-DD)
### Completed
- [x] step — key decision / why

### Remaining
- [ ] next step

### Blockers / Open Questions
- item
```

## Architectural Decision Records (ADRs)

When a non-obvious design decision is made, write an ADR:
- Location: `docs/adr/NNN-short-title.md` (use `docs/adr/TEMPLATE.md`)
- Commit: `docs(adr): NNN short title`
- Add a one-liner to `docs/adr/INDEX.md`

ADRs prevent re-litigating decisions across sessions and document the "why" behind legacy patterns.

## Dead Code

Note dead code with a comment (`// TODO: dead — safe to remove YYYY-MM-DD`) but don't clean it up in the same PR as a feature change. Address in a dedicated cleanup commit to keep diffs reviewable.

---

# Knowledge Graph

`graphify-out/GRAPH_REPORT.md` is the persistent codebase knowledge graph. It maps which files are "god nodes" (high connectivity), what module communities exist, and which files are unexpectedly coupled.

**Query order** — always follow this to minimise token spend:
1. Read `graphify-out/GRAPH_REPORT.md` → get structural orientation
2. Read only the specific files the graph points to
3. Fall back to Grep/Glob only for areas the graph doesn't cover

**Build / refresh the graph:**
```bash
/graphify .         # full scan of the current directory
/graphify app/      # scan only a subtree
```

Run `/graphify .` at the start of any new multi-file task. The hook in `.claude/settings.json` will remind you when a graph exists before every Glob/Glob search.

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

`MEMORY_TOKEN` lives in Doppler. Prefix every command with `doppler run --` to inject it.

```bash
# Template — replace the path at the end
doppler run -- bash -c '
  curl -s -H "Authorization: token $MEMORY_TOKEN" \
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
  SHA=$(curl -s -H "Authorization: token $MEMORY_TOKEN" \
    "https://api.github.com/repos/pinnacleadvisors/nexus-memory/contents/roadmap/SUMMARY.md" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)[\"sha\"])")

  CONTENT=$(printf "%s" "# New content here" | base64 -w0)

  curl -s -X PUT \
    -H "Authorization: token $MEMORY_TOKEN" \
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
