# Global Claude Code Protocols

These are the protocols and conventions that apply to **every** repo in this org. Copy this file's contents into `~/.claude/CLAUDE.md` on each machine where you run Claude Code so the same rules load before any per-repo `CLAUDE.md` / `AGENTS.md`.

Per-repo files (`CLAUDE.md` in each project) only need the project-specific bits: stack rules, file layout, env-var lists. Everything below is universal.

---

# Memory Architecture — the 3-layer system

Every repo's `memory/` directory is the canonical context base for that project. Sessions load Layer 1 automatically, query Layer 2 on-demand, and promote Layer 3 scratch into Layer 2 before the session ends.

| Layer | Name | Volatility | Purpose | Where it lives |
|---|---|---|---|---|
| **1** | Project Brief | rarely changes | Persistent rules, stack decisions, ADRs | `memory/platform/*.md`, `CLAUDE.md`, `AGENTS.md`, `docs/adr/` |
| **2** | Project State | evolves across sessions | Roadmap, current long-horizon plan, run state | `memory/roadmap/*.md`, `task_plan.md`, `memory/runs/` |
| **2c** | Cross-project knowledge graph | evolves across **all** repos | Atomic facts, entities, MOCs | central `memory-hq` repo (Supabase mirror) — see "Memory HQ" below |
| **3** | Session Memory | volatile | Scratch context | chat — promoted to Layer 2 before session ends |

**Read order for any task:**
1. Per-repo `memory/INDEX.md` — topic map for *this* project
2. Specific Layer-1 files the task hits (e.g. `STACK.md`)
3. Layer-2 files: `task_plan.md` for the active long-horizon plan, `memory/roadmap/SUMMARY.md` for status
4. Layer-2c (cross-project): `memory_query` MCP tool or `cli.mjs --backend=github query "<text>"` — central graph
5. Fall back to Grep/Glob only when memory doesn't cover the area

**Promotion protocol (COPY → VERIFY → DELETE):** any Layer-3 fact becomes durable by being written to Layer 2 (atom in central graph, ADR, Progress entry), re-read to confirm, then dropped from scratch.

**Write rules:**
- Feature status changed → `memory/roadmap/SUMMARY.md` (per-repo)
- New stack rule → per-repo `memory/platform/STACK.md`
- New env var → per-repo `memory/platform/SECRETS.md`
- Durable cross-project fact → write to `memory-hq` (see below)
- Non-obvious design decision → ADR in `docs/adr/`
- Long-horizon task progress → `task_plan.md` `## Progress`

---

# Long-Horizon Task Protocol

Multi-session or multi-hour tasks follow a strict 4-step workflow. **Never jump straight to implementation.**

## Step 0 — North Star (always first)

Before any exploration, write three lines at the top of `task_plan.md`:

```
Goal: <one sentence>
Success criteria: <bullet list of verifiable outcomes>
Hard constraints: <what must not break>
```

Every later decision checks back against these. If implementation drifts, stop and replan.

## Phase 1 — Explore

Map the surface area before touching code:
- Check the cross-project knowledge graph first (`memory_search` MCP tool or `cli.mjs --backend=github query`)
- Read entry points, interfaces, and all callers
- Identify hidden global state and implicit contracts
- Record findings in `task_plan.md`

## Phase 2 — Plan

Atomic-task format (each task 2–5 minutes, fits one Write/Edit call under the 300-line cap):

```
### Task N — short title
- File: `path/to/file.ts`
- Change: one sentence
- Verify: how to confirm it worked
- Parallel: yes / no
```

User must review before Phase 3.

## Phase 3 — Implement

- TDD when possible (RED → GREEN → REFACTOR)
- Run typecheck after every significant change
- Commit per atomic task — stream errors cost ≤ 1 task
- Never implement beyond the plan; open follow-ups instead

## PDCA Gates

Pause at each checkpoint:

| Checkpoint | Gate question |
|---|---|
| After Explore | Does the plan target the right code? |
| After each commit | Does this move toward the success criteria? |
| After full implementation | Do all success criteria pass? |
| Before PR | Is the diff reviewable? |

## Context Compaction

When a session grows long, before it degrades:
1. Update `task_plan.md` `## Progress`
2. Promote durable facts to Layer 2 / memory-hq
3. Commit
4. Start a fresh session — open `task_plan.md` to restore context

---

# Memory HQ — the cross-project knowledge graph

Central GitHub repo: `pinnacleadvisors/memory-hq` (private). Every AI model and every repo writes facts here through one of three paths:

| Path | When | How |
|---|---|---|
| `mcp-memory` MCP tools | inside any Claude Code session | `memory_atom`, `memory_entity`, `memory_search` (register the server in `~/.claude/settings.json`) |
| `/api/memory/event` curl | n8n, OpenClaw, external webhooks | `POST` with `Authorization: Bearer $MEMORY_HQ_TOKEN` |
| `cli.mjs --backend=github` | shell scripts, CI, ad-hoc | runs from any clone of `nexus` |

All three converge on the same endpoint, so atoms written from any path show up in the same graph with full provenance (`frontmatter.author = <source>`).

## Scope (disambiguates same-named facts across projects)

Every atom carries `frontmatter.scope: { repo?, business_slug?, namespace? }`. Storage layout in `memory-hq`:

```
<kind>/<scope-id>/<slug>.md   # kind = atoms|entities|mocs|sources|synthesis
```

`scope-id` = first 8 chars of sha1(canonical scope JSON) + human suffix. Two writers using identical scope → same id. CLI auto-fills `scope.repo` from `git remote get-url origin` when omitted.

## Locators (point at the underlying asset)

`frontmatter.locators[]` — structured pointers so an agent can fetch the actual image / video / PDF / source file from wherever it lives. Multi-locator atoms self-heal — a 404 on R2 falls back to the next entry.

Supported kinds:
- `github` — `{repo, path, ref?, line?}`
- `r2` / `s3` — `{bucket, key, ...}`
- `url` — `{href}`
- `youtube` — `{video_id}`
- `vercel-blob` / `local`

Resolved by `lib/memory/locator.ts` (per-kind credentials read from Doppler).

## Read

Reads go through the Supabase mirror — pgvector + FTS, no GitHub rate limit. The MCP `memory_search` and `memory_query` tools, plus `GET /api/memory/query`, all hit Supabase.

Source of truth is still GitHub. If the mirror drifts, hit `GET /api/cron/sync-memory?reconcile=1` to re-sync from the tree.

## Write rules for the central graph

- **One file per atom/entity/MOC** — never coalesce. Two writers on different items must never collide.
- **Always stamp provenance** (`source` field on the API). Endpoint stamps `frontmatter.author`.
- **No PII or secrets.** Even though `memory-hq` is private, treat its contents as public.
- **No client touches `INDEX.md`, `.graph.json`, or `digest/*.md`** — those are owned by `/api/cron/rebuild-graph-hq`. Concurrent client writes never conflict on them.
- **Logs are file-per-event** (`log/<iso>-<op>-<slug>.md`) — never append to a single file.

---

# Write Size Discipline (avoid Opus stream timeouts)

Long single-shot Write/Edit/Bash payloads are the #1 cause of Opus stream errors. The PreToolUse hook `.claude/hooks/check-write-size.sh` enforces these limits — exceeding them blocks the call. Defaults: **300 lines / 10 KB per Write/Edit**, **300 lines per Bash heredoc**.

Patterns to use, in order of preference:

- **New large file → skeleton + fill.** Write headers + empty section markers in call 1; Edit each section in its own call.
- **Existing file → Edit, never Write.** Re-emitting the full file to change a few lines wastes the stream.
- **Append-only content → Bash heredoc append** (`cat >> path <<'EOF' ... EOF`).
- **Bulk generated data → external script.** Emit a Node/Python generator, run it once. Stream the *script*, not the data.
- **After each chunk lands, Read to verify.** Stream errors leave files in undefined state.

For long-horizon work: every atomic task in `task_plan.md` should fit one Write/Edit call under 300 lines. Split a 1000-line file into `Task Na — scaffold`, `Task Nb — section A`, etc. Commit per chunk so a stream error costs ≤ 1 task.

---

# Skill Routing — when to invoke which `/skill`

| If the prompt asks to… | Use |
|---|---|
| Read a public URL | `/firecrawl_local scrape <url>` |
| Discover URLs on a site | `/firecrawl_local map <url>` |
| Walk a small section of a site (≤ 20 pages) | `/firecrawl_local crawl <url>` |
| Search the open web | Tavily or built-in **WebSearch** |
| Remember a durable fact across sessions | `memory_atom` MCP tool **(preferred)** or `cli.mjs --backend=github atom` |
| Look up a person/company/concept | `memory_search` MCP tool or `cli.mjs --backend=github query` |
| Summarise / ingest an article | scrape → `cli.mjs ingest` → atoms via `memory_atom` |
| Health-check the local graph | `/molecularmemory_local lint --write` (per-repo) |
| Build a Map of Content | `memory_moc` MCP tool or `cli.mjs moc` |
| Red-Green-Refactor TDD | `/superpowers` TDD skill |
| Systematic 4-phase debugging | `/superpowers` debugging skill |
| Review pending changes | `/review` (built-in) |
| Security audit a diff | `/security-review` (built-in) |
| Tighten permission prompts | `/fewer-permission-prompts` |

## Decision logic

1. Read the hint block from the `skill-router` UserPromptSubmit hook if present.
2. Only invoke a skill when the match is genuine — false-positive keyword matches are worse than no suggestion.
3. Only invoke skills listed in the session's available-skills list. Anything else is documentation-only until installed.
4. Chain skills when the prompt spans domains: e.g. "research X and save key facts" = `firecrawl_local scrape` → extract atoms → `memory_atom` (loop).
5. If no skill fits, fall back to the 4-step task protocol above.

## If a skill is referenced but not available

- `/superpowers`, `/claude-evolve` — declared in `.claude/settings.json` `extraKnownMarketplaces`. Restart the session if not listed.
- `/firecrawl` (hosted) — needs `FIRECRAWL_API_KEY`; the local substitute `/firecrawl_local` handles scrape/map/crawl without a key.
