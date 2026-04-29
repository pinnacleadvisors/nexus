# Agent Framework

A model-agnostic protocol for AI agents collaborating on shared codebases and a shared knowledge graph. Implementation specifics for any given model live in `ADAPTERS/<model>.md`.

Five sections:
1. Memory architecture
2. Long-horizon task protocol
3. Output discipline
4. Memory HQ protocol (read + write + provenance)
5. Multi-model collaboration

---

# 1. Memory architecture

Every agent operates against three layers of memory, separated by **volatility** rather than purpose.

| Layer | Volatility | What lives there | Primary location |
|---|---|---|---|
| **L1 — Brief** | rarely changes | Persistent rules, stack decisions, ADRs, system prompts | per-repo files (`AGENTS.md`, `STACK.md`), per-agent instruction file |
| **L2 — State** | evolves across sessions | Roadmap, active plan, run state, run history | per-repo files (`task_plan.md`, `roadmap/`), per-run logs |
| **L2c — Cross-project graph** | evolves across **all** projects | Atomic facts, entities, MOCs | central `memory-hq` repo (Supabase mirror for fast reads) |
| **L3 — Session** | volatile, current chat only | Scratch context, in-flight decisions | the conversation itself |

## Read order

1. L1 entry doc (per-agent instructions / system prompt)
2. L2 plan (`task_plan.md` if active)
3. L2c graph — query memory-hq before re-deriving facts
4. Specific L1 files relevant to the task
5. Fall back to direct file reads / search only when memory doesn't cover the area

The point of L2c: facts learned by one agent on one task become available to every other agent on every later task. Non-trivial findings should land in the graph.

## Promotion protocol — COPY → VERIFY → DELETE

A volatile L3 fact becomes durable in three steps:

1. **COPY** to L2 (atom in memory-hq, ADR, plan progress entry)
2. **VERIFY** by re-reading the written location (catches silent write failures)
3. **DELETE** from scratch context

Never let a durable decision live only in chat — the next session starts blind.

## Write rules

- New stack rule / dev convention → per-repo L1 file
- New env var → per-repo L1 secrets file
- Durable cross-project fact → L2c (memory-hq atom)
- Non-obvious design decision → ADR file (also L1)
- Long-horizon task progress → L2 plan file's `## Progress`

Dense summaries — never duplicate full source documents.

---

# 2. Long-horizon task protocol

For any task that spans more than ~30 minutes or multiple sessions, follow a strict 4-step workflow. **Do not skip to implementation.**

## Step 0 — North Star

Before any exploration, write three lines at the top of the plan file:

```
Goal:              <one sentence>
Success criteria:  <bullet list of verifiable outcomes>
Hard constraints:  <what must not break>
```

Every later decision checks back against these. If implementation drifts from them, stop and replan.

## Phase 1 — Explore

Map the surface area before touching code:
- Query the cross-project graph (L2c) for prior facts on the area
- Read entry points, interfaces, and all callers
- Identify hidden global state and implicit contracts
- Record findings in the plan file

## Phase 2 — Plan

Decompose into **atomic tasks**, each sized to fit one tool call under the output cap (see §3):

```
### Task N — short title
- File:    <path>
- Change:  one sentence
- Verify:  how to confirm it worked
- Parallel: yes / no
```

Tasks marked `Parallel: yes` can be dispatched concurrently. The user reviews and approves the plan before Phase 3.

## Phase 3 — Implement

- Test-first when possible (RED → GREEN → REFACTOR)
- Run typecheck after each change
- Commit per atomic task — a stream error then costs ≤ 1 task
- Never implement beyond the plan; open follow-ups instead

## PDCA gates

Pause at each gate and check against North Star:

| Gate | Question |
|---|---|
| After Explore | Does the plan target the right code? |
| After each commit | Does this move toward the success criteria? |
| After implementation | Do all success criteria pass? |
| Before review | Is the diff reviewable? |

## Context compaction

When a session grows long, before quality degrades:
1. Update plan file's `## Progress` block
2. Promote durable facts to L2c (memory-hq)
3. Commit
4. Start a fresh session and re-open the plan to restore context

---

# 3. Output discipline

Most "model errors" on long file writes are actually **stream timeouts** on the output channel: the model emits a very large response in one tool call and the network/idle timer trips. The fix is mechanical, not magical: cap any single output and split the work.

## Universal limits (override per model in adapter)

| Operation | Soft cap | Why |
|---|---|---|
| File write / file edit | **300 lines / 10 KB** of new content | Empirically the upper edge before stream errors spike |
| Shell heredoc append | **300 lines** of inlined content | Same channel, same risk |
| Single response to user | model-dependent | Defer to per-model budgets |

These caps are not aspirational — they should be **enforced** by a pre-tool-call guard wherever possible. Soft policy in instructions is biasing-only; runtime enforcement makes it deterministic.

## Patterns, in order of preference

1. **Skeleton + fill.** New large file → write headers + empty section markers (1 call), then fill each section with its own edit call. Each call is small and independent; a stream error costs ≤ 1 section.
2. **Edit, never rewrite.** To change a few lines in an existing file, target those lines specifically. Re-emitting the full file wastes the stream and risks timeout.
3. **Anchored multi-pass edits.** Refactors touching N sections → N edits, each anchored on a unique string (a heading, a comment marker). Idempotent + restartable.
4. **Shell append for additive content.** Configs, seed lists, generated docs that only grow → shell heredoc append. The model emits only the new chunk.
5. **External script for bulk data.** 1000+ rows of seed data, scaffolded code, generated fixtures → write a small Node/Python generator, run it once, commit the output. Stream the *script*, not the data.

## After every chunk, verify

A stream error leaves a file in undefined state. Always re-read the target before issuing the next write. Never blindly retry the same write — it may have partially landed.

## Plan integration

Every atomic task in a long-horizon plan should fit one tool call under the cap. If a task implies a 1000-line file, split into:
- `Task Na — scaffold` (skeleton, well under cap)
- `Task Nb — section A` (one edit)
- `Task Nc — section B` (one edit)
- ...

Commit per task. A stream error costs ≤ 1 task, never the whole feature.

---

# 4. Memory HQ protocol

The cross-project knowledge graph (L2c) lives in a private GitHub repo (default name `memory-hq`). Every model and every project writes here through one of three paths — all converging on the same HTTP endpoint so provenance and rate-limiting stay centralised.

## Write paths

| Path | Best for |
|---|---|
| Native MCP tools (when available) | inside an agent session — write feels like a tool call, not an HTTP shell-out |
| `POST /api/memory/event` curl | external automation (workflow engines, webhooks, custom agents) |
| `cli.mjs --backend=github` | shell scripts, CI runners, ad-hoc one-offs |

All three accept the same body shape:

```json
{
  "type": "atom" | "entity" | "moc" | "source" | "synthesis",
  "source": "<writer-identity>",            // e.g. "openai-assistant:research", "claude-agent:architect", "n8n:idea-builder"
  "scope": { "repo": "...", "business_slug": "...", "namespace": "..." },
  "payload": { "title": "...", "fact": "...", "importance": "critical|high|normal|low" },
  "locators": [ { "kind": "url|youtube|r2|s3|github|...", ... } ],
  "trace_id": "..."
}
```

## Required fields, non-negotiable

- **`source`** — every write stamps `frontmatter.author` with this. Provenance is how we audit which model wrote what.
- **`scope`** — must include `repo` OR `business_slug`. Disambiguates same-named facts across projects.
- **`payload.title`** — slugified into the file name.

## Scope canonicalisation

Storage layout: `<kind>/<scope-id>/<slug>.md` where `scope-id` = first 8 chars of sha1 of canonical scope JSON + a human suffix. Two writers with identical scope inputs always produce the same scope-id. The CLI auto-fills `scope.repo` from the working git remote when omitted.

## Locators — point at the underlying asset

`frontmatter.locators[]` is an array of structured pointers. Each entry has a `kind` discriminator and kind-specific fields. Multi-locator atoms self-heal — if the first kind 404s, the next is tried.

| `kind` | Fields | Use |
|---|---|---|
| `url` | `href` | Plain HTTP resource |
| `github` | `repo`, `path`, `ref?`, `line?` | Code or doc inside a GitHub repo |
| `r2` / `s3` | `bucket`, `key`, region/account | Object storage |
| `youtube` | `video_id` | Video |
| `vercel-blob` | `url` | Vercel Blob asset |
| `local` | `path` | Filesystem (CI/dev only) |

A fact about *a video* can carry the YouTube ID, the R2 backup, *and* the transcript URL together. Each agent picks the locator it can resolve.

## Read paths

Reads route through the Supabase mirror — pgvector + full-text search, no GitHub rate limit. The mirror is updated by a webhook on every push to memory-hq. If it ever drifts, a reconcile endpoint replays from the GitHub tree.

| Path | Use |
|---|---|
| MCP `memory_search` / `memory_query` | inside an agent session |
| `GET /api/memory/query` | external readers |
| `cli.mjs --backend=github query` | offline / ad-hoc (slug match only — for FTS use the API) |

## Write rules — concurrency-safe by construction

- **One file per item.** Atoms / entities / MOCs each get their own file. Two writers on different items never collide.
- **Generated files are cron-owned.** `INDEX.md`, `digest/*.md`, any aggregation files are regenerated by a single cron job. Clients never write them.
- **Logs are file-per-event.** Format: `log/<iso>-<op>-<slug>.md`. No appending to a single log file — that's the worst conflict pattern.
- **No PII or secrets** ever land in atoms. Even though the repo is private, treat its contents as if they were public.

---

# 5. Multi-model collaboration

Different AI models have different strengths. Treating them as interchangeable workers misses the point; treating them as adversaries (one model "approves" another's work) doubles spend without doubling quality. The framework gives each model a defined role + a shared substrate (memory-hq) so they compose.

## Composition patterns

| Pattern | Example | Where the framework helps |
|---|---|---|
| Specialist + verifier | one model produces, a second checks | Both write to the same graph with `kind: produced` / `kind: verified` provenance — easy to audit divergence later |
| Pipeline | research → write → review → publish | Each step writes its output as an atom with `links: [<previous>]`, so the chain is reconstructable |
| Council / vote | multiple models propose, owner picks | Each proposal is an atom with `kind: proposal` and `frontmatter.confidence` — the picker queries by `kind:proposal scope:<task>` |
| Memory-only / no model | external webhook fires a fact | Same `/api/memory/event` shape — the writer's `source` field marks it as non-model-derived |

## Provenance discipline

Every atom carries:
- `frontmatter.author` — which agent / model / human / webhook wrote it
- `frontmatter.trace_id` — links related events from the same workflow
- `frontmatter.kind` — the role this atom plays (`fact`, `decision`, `proposal`, `verified`, `agent-run`, ...)
- `frontmatter.importance` — `critical` / `high` / `normal` / `low`

The cron digest job filters `kind:decision AND importance:critical` to surface "what changed this week" automatically. Without consistent author/kind/importance, that view degrades to noise.

## Model-specific quirks live in adapters

Anything tool-shaped — exact tool names, hook syntax, instruction file paths, MCP registration, output token budgets — belongs in `ADAPTERS/<model>.md`. The principles in this file should never need a per-model variant.

If an adapter contradicts a principle here, the principle wins — file a follow-up to fix the adapter, don't bend the principle.

## Onboarding a new model

To bring a new model into the org:
1. Read this whole document.
2. Fork an existing adapter (closest match) into `ADAPTERS/<model>.md` and replace tool names / output budgets.
3. Verify the adapter against the principles checklist:
   - Can the model enforce output caps at runtime, or only as soft instructions?
   - Does the model's tool surface include a write-then-verify pattern?
   - Can it emit `Authorization: Bearer` headers for `/api/memory/event`?
   - Does it have an MCP-equivalent (native tool support) or only HTTP-out?
4. Run a smoke task: write 3 atoms with full provenance, query them back, verify scope handling.
5. Submit the adapter PR. Reviewers focus on whether tool-mappings are faithful to the principles.

The graph compounds in value as more models contribute. The framework's job is to make that compounding cost-free.
