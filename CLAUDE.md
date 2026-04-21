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

We use **two** knowledge graphs, each for a different purpose:

| Graph | What it captures | Built by |
|-------|------------------|----------|
| `graphify-out/GRAPH_REPORT.md` | File-level import/call structure of the **codebase** (god nodes, modules, coupling) | `/graphify` (external plugin — install from `safishamsi/graphify` if not present) |
| `memory/molecular/` + `memory/molecular/.graph.json` | **Domain knowledge** — atomic facts, entities, Maps of Content | `/molecularmemory_local` (built-in, `.claude/skills/molecularmemory_local/`) |

Both are optional. `/molecularmemory_local` is the preferred default because it lives in-repo, needs zero tokens, and is the replacement path for `/graphify` when that plugin is unavailable.

**Query order** — always follow this to minimise token spend:
1. Read `memory/INDEX.md` → platform docs map
2. Read `memory/molecular/INDEX.md` (if present) → domain knowledge map
3. Read `graphify-out/GRAPH_REPORT.md` (if present) → codebase structure
4. Read only the specific files the graphs point to
5. Fall back to Grep/Glob only for areas the graphs don't cover

**Build / refresh the codebase graph:**
```bash
/graphify .         # full scan — requires safishamsi/graphify plugin installed
```

**Build / refresh the domain graph:**
```bash
node .claude/skills/molecularmemory_local/cli.mjs init     # first time
node .claude/skills/molecularmemory_local/cli.mjs graph    # rebuild adjacency
node .claude/skills/molecularmemory_local/cli.mjs reindex  # refresh INDEX.md
```

The hook in `.claude/settings.json` reminds Claude when either graph exists before Glob/Grep searches.

---

# Skill Routing — when to invoke which `/skill`

Claude Code has many skills available. The decision of which (if any) to invoke after a prompt follows this rubric. The `UserPromptSubmit` hook at `.claude/hooks/skill-router.sh` echoes hints automatically — these rules are the authoritative version.

| If the prompt asks to… | Use |
|---|---|
| Read a specific public URL or page | `/firecrawl_local scrape <url>` |
| Discover URLs on a site | `/firecrawl_local map <url>` |
| Walk a small section of a site (≤ 20 pages) | `/firecrawl_local crawl <url> --limit=N` |
| Search the open web by topic | Tavily (`lib/tools/tavily.ts`) or built-in **WebSearch** — `/firecrawl_local` cannot do search |
| Remember a durable fact across sessions | `/molecularmemory_local atom` + `entity` |
| Extract atomic facts from an article/paper/transcript | **scrape with /firecrawl_local → `/molecularmemory_local atom` per fact** |
| Build a Map of Content for a topic | `/molecularmemory_local moc` |
| Query existing domain knowledge | `/molecularmemory_local query <text>` |
| Navigate a multi-file refactor | Read `graphify-out/GRAPH_REPORT.md` if fresh, else start an MOC in `/molecularmemory_local` for the affected module |
| Red-Green-Refactor TDD flow | `/superpowers` TDD skill (if installed via `obra/superpowers-marketplace`) |
| Systematic 4-phase debugging | `/superpowers` debugging skill |
| Personalised pattern capture | `/claude-evolve` (if installed via `hknc/claude-evolve`) |
| Review pending code changes | `/review` (built-in) |
| Security audit of a diff | `/security-review` (built-in) |
| Scaffold CLAUDE.md | `/init` (built-in) |
| Tighten permission prompts | `/fewer-permission-prompts` (built-in) |
| Remove cruft from recent changes | `/simplify` (built-in) |
| Set up recurring tasks | `/loop` (built-in) |

## Decision logic (what to do after every user prompt)

1. **Read the hint block** if the `skill-router` hook injected one — that's the cheapest signal.
2. **Only invoke a skill when the match is genuine.** False-positive keyword matches are worse than no suggestion. Prefer the hook's "ignore if not applicable" advice.
3. **Never invoke a skill that isn't in the session's available-skills list.** Those listed in the session-start system-reminder are the only callable ones; anything else is documentation-only until installed.
4. **Chain skills when the prompt spans domains** — e.g. "research X and save key facts" = `/firecrawl_local scrape` → Claude extracts atoms → `/molecularmemory_local atom` (loop) → `graph` → `reindex`.
5. **If no skill fits, fall back to the 4-step task protocol** (North Star → Explore → Plan → Implement) above.

## If a skill is referenced but not available

- `/graphify` → install from `https://github.com/safishamsi/graphify`, or substitute `/molecularmemory_local` for module-level knowledge.
- `/superpowers`, `/claude-evolve` → both are declared in `.claude/settings.json` under `extraKnownMarketplaces`. If not listed in the session's skills, restart the Claude Code session so the marketplaces are fetched and plugins enabled.
- `/firecrawl` (hosted) → requires `FIRECRAWL_API_KEY` in Doppler; the local substitute `/firecrawl_local` handles scrape/map/crawl without a key.

---

# Platform Memory

Platform knowledge lives in `memory/` — local to this repo, plain file reads, no API calls needed.

## Query order (saves 10× tokens vs scanning source docs)

1. Read `memory/INDEX.md` (~300 tokens) — find which 1–2 files you need
2. Read only those files
3. Use `memory/GRAPH.md` to discover related files if needed

## Files

| What you need | Path |
|---------------|------|
| Topic map (start here) | `memory/INDEX.md` |
| Stack & dev rules | `memory/platform/STACK.md` |
| File structure, API patterns | `memory/platform/ARCHITECTURE.md` |
| All env vars by phase | `memory/platform/SECRETS.md` |
| What Nexus is, all pages | `memory/platform/OVERVIEW.md` |
| Phase 1–22 status | `memory/roadmap/SUMMARY.md` |
| Not-started items | `memory/roadmap/PENDING.md` |

## Keeping memory current

After completing a feature, update the relevant file with a plain Edit — no scripts, no API calls:

- Feature status changed → edit `memory/roadmap/SUMMARY.md` + `memory/roadmap/PENDING.md`
- New dev rule discovered → edit `memory/platform/STACK.md`
- Architecture changed → edit `memory/platform/ARCHITECTURE.md`
- New env var added → edit `memory/platform/SECRETS.md`

Always write dense summaries — never duplicate full source docs.
