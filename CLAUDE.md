@AGENTS.md

---

> **Cross-repo protocols** — the 3-layer memory architecture, long-horizon task protocol, write-size discipline, memory-hq usage, and skill routing rules below also live as a standalone doc at `docs/global-claude-protocols.md`. Copy that file into `~/.claude/CLAUDE.md` on each machine where you run Claude Code — it then applies to every repo, and the duplicated sections here can be trimmed (the only Nexus-specific section that must stay is `# Platform Memory — quick reference` at the bottom).
>
> **Follow-up TODO**: once `~/.claude/CLAUDE.md` is verified working from a sibling repo, replace lines 1–229 of this file with `@AGENTS.md` and a small Nexus-specific note. Tracked as Step 7 in `task_plan-memory-architecture.md`.

---

# Memory Architecture — the 3-layer system

`memory/` is Nexus's canonical context base. Every session loads Layer 1 automatically, queries Layer 2 on-demand, and promotes Layer 3 scratch into Layer 2 before a session ends. Inspired by Felixcraft.ai / Nat Eliason's OpenClaw framework — layers separated by volatility.

| Layer | Name | Volatility | Purpose | Primary paths |
|-------|------|------------|---------|---------------|
| **1** | Project Brief (stable) | Rarely changes | Persistent rules, stack decisions, product definition, ADRs | `memory/platform/*.md`, `CLAUDE.md`, `AGENTS.md`, `docs/adr/` |
| **2** | Project State (living) | Evolves across sessions | Roadmap status, active long-horizon plan, per-run state, domain knowledge graph | `memory/roadmap/*.md`, `task_plan.md`, `memory/runs/`, `memory/molecular/` |
| **3** | Session Memory (volatile) | Current chat only | Scratch decisions, open questions, in-flight context | Chat context — promoted via `/molecularmemory_local` or a `task_plan.md` Progress update |

**Read order for any task:**
1. `memory/INDEX.md` (~500 tokens) — topic map across all three layers
2. Any specific Layer-1 file (`platform/STACK.md`, etc.) the task hits
3. Layer-2 files as needed: `task_plan.md` for long-horizon work, `roadmap/SUMMARY.md` for feature status, `molecular/INDEX.md` for domain knowledge
4. Fall back to Grep/Glob only when the memory files don't cover the area

**Promotion protocol (COPY → VERIFY → DELETE):** a Layer-3 fact becomes durable by being written to Layer 2 (atom, entity, Progress entry, ADR), then re-read to confirm the write, then dropped from scratch. Never let a durable decision live only in chat context — the next session will start blind.

**Write rules (keep memory current):**
- Feature status changed → edit `memory/roadmap/SUMMARY.md` + `memory/roadmap/PENDING.md`
- New dev rule / stack constraint → edit `memory/platform/STACK.md`
- New route / component / lib file → edit `memory/platform/ARCHITECTURE.md`
- New env var → edit `memory/platform/SECRETS.md`
- Durable domain fact → `node .claude/skills/molecularmemory_local/cli.mjs atom "<title>" --fact="..." --source=<ref>`
- Non-obvious design choice → write an ADR (`docs/adr/NNN-title.md`) + index it
- Long-horizon task progress → edit `task_plan.md` `## Progress`

Write dense summaries — never duplicate full source docs.

---

# Branch Sync Protocol — keep `main` as the moving target

**Always sync with `origin/main` before AND after a unit of work.** Stale branches cause merge conflicts that surface only at PR time, when the diff is large and the reviewer is already engaged. This is non-negotiable for any change that lands as a PR.

## Before making changes — pull `main` first

Run these as the very first commands of any task that will edit code:
```bash
git fetch origin main
git log --oneline HEAD..origin/main          # what's new on main since I last looked?
git rebase origin/main                       # OR git merge origin/main, repo policy is rebase
```

Reasons:
- Another PR may have just shipped a fix in the same area you're about to touch — read those commits before writing your own.
- Memory files (`memory/`, `docs/adr/`, `CLAUDE.md`, `AGENTS.md`) are mutated frequently. Working from a stale copy means writing rules that contradict what already shipped.
- A worktree branch that's behind by 20 commits is a conflict trap, not a feature branch.

If you're already on a feature branch from a previous session, rebase it onto `origin/main` before resuming — don't trust that yesterday's branch is still a clean base.

## After changes — re-sync, then open the PR

When your commits are ready and tests pass:

```bash
git fetch origin main
git rebase origin/main                       # one more time, mainline may have moved
npx tsc --noEmit && npm run check:retry-storm
git push -u origin <branch>
gh pr create --base main ...
```

If the rebase introduces conflicts: resolve them locally, re-run typecheck and the retry-storm guard, force-push (`git push --force-with-lease`), and only then open the PR. Never open a PR with `mergeable: CONFLICTING` — GitHub UI conflict resolution loses signing and skips hooks.

If the previous PR for this branch was already merged (check with `gh pr view <branch> --json state`) and you have new commits on top, open a **new PR from a fresh branch** off the latest `main`. Pushing more commits to a merged-PR branch leaves them stranded and unreviewed.

## When the rebase conflicts on memory files

`memory/molecular/`, `memory/roadmap/`, and `task_plan.md` are written by many sessions. If they conflict on rebase, prefer the version that captures the union of facts (don't blow away the other side). For generated indexes (`memory/molecular/INDEX.md`, `memory/molecular/.graph.json`), regenerate from source after the rebase rather than hand-resolving:
```bash
node .claude/skills/molecularmemory_local/cli.mjs reindex
node .claude/skills/molecularmemory_local/cli.mjs graph
```

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
- **Check the domain knowledge graph first**: read `memory/molecular/INDEX.md` and follow `[[wikilinks]]` from the relevant MOC — this anchors the work without rescanning files
- Read entry points, interfaces, and all callers for the targeted code
- Identify hidden global state, environment assumptions, and implicit contracts
- Check for existing tests covering the area
- Record findings in `task_plan.md`

> If `memory/molecular/` is empty or sparse for the area you're touching, seed it: run `node .claude/skills/molecularmemory_local/cli.mjs moc "<module-name>"` and start linking atoms as you explore.

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
2. Promote durable facts discovered during the session into Layer 2 (`/molecularmemory_local atom`, ADR, memory edit)
3. Commit: `git commit -m "chore: update task_plan progress"`
4. Start a fresh session — open `task_plan.md` + `memory/INDEX.md` to restore context instantly

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

ADRs prevent re-litigating decisions across sessions and document the "why" behind legacy patterns. They are Layer-1 memory.

## Dead Code

Note dead code with a comment (`// TODO: dead — safe to remove YYYY-MM-DD`) but don't clean it up in the same PR as a feature change. Address in a dedicated cleanup commit to keep diffs reviewable.

---

# Knowledge Graph — `/molecularmemory_local`

The single domain knowledge graph lives at `memory/molecular/` and is built by the **`/molecularmemory_local`** skill (`.claude/skills/molecularmemory_local/cli.mjs`). It is zero-token, pure-Node, and in-repo — no external plugin required.

Structure:

```
memory/molecular/
├── INDEX.md             ← generated homepage — MOCs/entities/atoms/sources/synthesis counts
├── log.md               ← append-only chronological record (ingest / synthesis / lint events)
├── atoms/<slug>.md      ← atomic notes (one fact each)
├── entities/<slug>.md   ← people, companies, concepts, projects
├── mocs/<slug>.md       ← Maps of Content (topic hubs)
├── sources/<slug>.md    ← page-per-ingested-document (URL/PDF/transcript summaries)
├── synthesis/<slug>.md  ← filed Q&A or multi-source essays
└── .graph.json          ← cached adjacency list (regenerated by `graph` cmd)
```

**Query order** — always follow this to minimise token spend:
1. `memory/INDEX.md` → platform docs map (3-layer architecture)
2. `memory/molecular/INDEX.md` → MOC list → pick the topic hub
3. Follow `[[wikilinks]]` from the MOC to atoms + entities
4. Read only the specific files the graph points to
5. Fall back to Grep/Glob only for areas the graph doesn't cover yet

**Build / refresh the graph:**
```bash
node .claude/skills/molecularmemory_local/cli.mjs init      # first time only
node .claude/skills/molecularmemory_local/cli.mjs atom "<title>" --fact="..." --source=<url>
node .claude/skills/molecularmemory_local/cli.mjs entity <person|company|concept|project> "<name>"
node .claude/skills/molecularmemory_local/cli.mjs moc "<topic>" --atoms=a,b --entities=x,y
node .claude/skills/molecularmemory_local/cli.mjs ingest <url> --title="..." --body=/tmp/<slug>.md --moc=<topic>
node .claude/skills/molecularmemory_local/cli.mjs synthesis "<title>" --body=/tmp/<answer>.md --question="..." --moc=<topic>
node .claude/skills/molecularmemory_local/cli.mjs lint --write   # health check + log entry
node .claude/skills/molecularmemory_local/cli.mjs log <op> "<title>" --ref=<path>   # primitive
node .claude/skills/molecularmemory_local/cli.mjs graph          # rebuild adjacency
node .claude/skills/molecularmemory_local/cli.mjs reindex        # refresh INDEX.md
node .claude/skills/molecularmemory_local/cli.mjs query "<text>"
```

**Karpathy ingest pattern** (the canonical "summarise this article" workflow): `firecrawl_local scrape <url> --output=/tmp/<slug>.md` → `cli.mjs ingest <url> --title="..." --body=/tmp/<slug>.md --moc=<topic>` → Claude extracts atoms with `cli.mjs atom` and back-references them under the source page's "Atoms extracted" section → `cli.mjs lint --write` to log a health snapshot.

Nightly the `POST /api/cron/rebuild-graph` endpoint re-runs `graph` + `reindex` and logs node/orphan/degree metrics to `metric_samples` (C8).

The PreToolUse hook in `.claude/settings.json` reminds Claude to check `memory/molecular/INDEX.md` before raw Glob/Grep searches.

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
| Summarise / ingest an article, PDF, or transcript | **scrape with /firecrawl_local → `/molecularmemory_local ingest` → `atom` per fact** |
| File a notable Q&A or cross-source essay | `/molecularmemory_local synthesis` |
| Health-check the knowledge graph (orphans, dangling links, stale atoms) | `/molecularmemory_local lint --write` |
| Build a Map of Content for a topic | `/molecularmemory_local moc` |
| Query existing domain knowledge | `/molecularmemory_local query <text>` |
| Navigate a multi-file refactor | Start a `/molecularmemory_local moc` for the affected module; atoms accumulate as you explore |
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

- `/superpowers`, `/claude-evolve` → both are declared in `.claude/settings.json` under `extraKnownMarketplaces`. If not listed in the session's skills, restart the Claude Code session so the marketplaces are fetched and plugins enabled.
- `/firecrawl` (hosted) → requires `FIRECRAWL_API_KEY` in Doppler; the local substitute `/firecrawl_local` handles scrape/map/crawl without a key.

---

# Platform Memory — quick reference

Layer 1 (stable) + Layer 2 (living) files by path:

| What you need | Path | Layer |
|---------------|------|-------|
| Topic map (start here) | `memory/INDEX.md` | 1 |
| Stack & dev rules | `memory/platform/STACK.md` | 1 |
| File structure, API patterns | `memory/platform/ARCHITECTURE.md` | 1 |
| All env vars by phase | `memory/platform/SECRETS.md` | 1 |
| What Nexus is, all pages | `memory/platform/OVERVIEW.md` | 1 |
| Architectural decisions | `docs/adr/INDEX.md` | 1 |
| Phase 1–22 status + SOE table | `memory/roadmap/SUMMARY.md` | 2 |
| Not-started items | `memory/roadmap/PENDING.md` | 2 |
| Current long-horizon plan | `task_plan.md` | 2 |
| Domain knowledge graph | `memory/molecular/INDEX.md` | 2 |
