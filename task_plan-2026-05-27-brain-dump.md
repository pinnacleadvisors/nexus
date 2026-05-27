# task_plan — 2026-05-27 operator brain-dump (consolidated)

> **Snapshot of the operator's parallel-feature wishlist + research items
> captured this session.** Each section below is a self-contained
> sub-plan. Items marked 🚀 are ready to ship; items marked 🔬 are
> research-only; items marked 📋 are scoped but deferred pending
> operator priority.

## Index

1. [Plugins viewable/configurable in settings tab](#plugins-viewable--configurable-in-settings-tab) — 📋 scoped, deferred
2. [Custom dashboard widgets / space-agent fork](#custom-dashboard-widgets--space-agent-fork) — 📋 scoped, deferred
3. [Voice control (open-source tools)](#voice-control-open-source-tools) — 📋 deferred
4. [Linear feature absorption](#linear-feature-absorption) — 📋 deferred until other backlog is empty
5. [AI council as skill](#ai-council-as-skill) — 📋 scoped, deferred
6. [Halo absorption (self-improving production agents)](#halo-absorption) — 🔬 research
7. [Smart caching for all agents](#smart-caching-for-all-agents) — 🚀 ready to ship
8. [Agents-of-Chaos security audit](#agents-of-chaos-security-audit) — 🚀 ready to ship
9. [Paperclip-prod walkthrough audit](#paperclip-prod-walkthrough-audit) — 🚀 ready to ship
10. [NVIDIA NIM provider adapter](#nvidia-nim-provider-adapter) — 🚀 ready to ship
11. [Skyreels v2 + Voxcpm + Ruflo + Plumoai](#research-items) — 🔬 research

---

## Plugins viewable & configurable in settings tab

**Status**: 📋 scoped, deferred.

**Why**: today the operator's plugin set lives across `.claude/agents/`,
`.claude/skills/`, `.claude/hooks/`, and `.claude/settings.json`. No
single UI surface lets the operator see "what's installed, what's
enabled, what's configured how". The brain-dump asked for one.

**Scope (1-PR ship)**:
- `/settings/plugins` route + `components/settings/PluginsList.tsx`
- Server-side resolver `lib/plugins/discover.ts` reads `.claude/`
  filesystem + the existing `agent_library` / `skills` DB tables and
  returns a unified `{kind, slug, name, status, config_keys, description,
  source_path}[]` list.
- Per-row enable/disable toggle (writes to a new `plugin_state` table —
  one row per (user_id, plugin_kind, slug)).
- Per-row "Configure" disclosure for env-var-style config knobs.
- Reuse existing skill-promote infra so a draft skill flips to verified
  via the same UI.

**Defer reason**: no immediate operator pain — the Loops/Sprints primitive
(`task_plan-loops-sprints.md`) is the higher-leverage abstraction. Plugins-
in-settings becomes natural once Loops ships (a Loop is one type of plugin).

---

## Custom dashboard widgets / space-agent fork

**Status**: 📋 scoped, deferred (per operator: "cool idea that could be
implemented in future").

**Why**: operator brain-dump suggested either (a) building a custom-widget
framework where operator paints `/dashboard`, or (b) forking
[`agent0ai/space-agent`](https://github.com/agent0ai/space-agent) for
per-business UI customisation.

**Scope (multi-PR)**:
- Migration: `dashboard_layouts` table (user_id, layout_json, default).
- New component `<WidgetCanvas />` with drag-rearrange + add/remove
  widget controls.
- Widget registry — every existing /dashboard component (FleetOverview,
  PlatformHealthWidget, KpiGrid, AlertsPanel, etc.) ships as a registered
  Widget with declared dimensions + data dependencies.
- Operator-saved layouts persist via the new table.

**Defer reason**: large effort + no concrete pain today. The current
dashboard already shows the right info; rearranging is cosmetic. Revisit
after R1-R12 + Loops ship.

**Alternative**: fork `space-agent` if its per-business UI customisation
is a better fit than building from scratch. Verify license + maintenance
cadence before committing.

---

## Voice control (open-source tools)

**Status**: 📋 deferred (per operator: "can be added later").

**Why**: the chat surface handles every operator task in 1 message;
voice is cool-demo, low-utility. Document the absorption recipe so it's
ready when priorities shift.

**Recipe**:
- Use open-source ASR (Whisper / VoxCPM if it ships) for the operator's
  voice input.
- Inject transcript into the existing chat poll route as a regular user
  message — no new dispatch path.
- Output: TTS via ElevenLabs / OpenAI TTS / VoxCPM via the existing
  `voice` ecosystem adapter slot.

**Defer reason**: low-leverage. Revisit after R1-R12.

---

## Linear feature absorption

**Status**: 📋 deferred ("in future implementation if nothing else to
work on").

**Why**: Paperclip already absorbed Linear's IM-style ticket UI patterns
into our `/businesses/<slug>/issues` surface. Operator brain-dump notes
Paperclip is "basically Linear for your AI agents" — so further Linear
absorption is incremental polish.

**Scope (deferred)**:
- Audit Linear's: project graph, milestone tracking, weekly velocity
  view, "Cycles" feature (their version of sprints — overlaps with our
  Loops plan).
- Map each feature to existing Nexus surfaces; ship the gaps as
  separate PRs.

**Defer reason**: no concrete pain. Revisit after R1-R12 + Loops.

---

## AI council as skill

**Status**: 📋 scoped, deferred ("add as plan but defer for now").

**Why**: a "council" of N models debating a decision is interesting for
high-stakes calls (niche pivot, pricing change). Should ship as a SKILL
that agents call when they need a council opinion, NOT a new agent type.

**Scope (1-PR ship when prioritised)**:
- `.claude/skills/ai-council/SKILL.md` — operator-callable
  (`/ai-council "Should I pivot Inkbound to a lower-priced tier?"`).
- The skill dispatches N parallel `claude` / `gpt-5` / `mimo` agents
  with the same brief, aggregates their answers, returns a
  weighted-consensus + dissenting-opinion summary.
- Cost-guard wraps the parallel fan-out hard.

**Defer reason**: operator explicitly deferred. Capture as plan so it's
ready when prioritised.

---

## Halo absorption

**Status**: 🔬 research (github.com/context-labs/halo).

**Why**: Halo is a self-improving harness for production agent
deployments. Pattern adjacent to our `workflow-optimizer` failure-cluster
scan but with online (vs scheduled) feedback.

**Recipe**:
- Read Halo's eval-harness-mounted-into-runtime pattern; check whether
  it fits our `h4` layer (per AGENTS.md harness taxonomy).
- If yes, file the absorption as new `edit-self`-eligible behaviour for
  workflow-optimizer.
- Continuous A/B of prompt + tool-call variants — adjacent to our LLM-voice
  A/B work but for agent behaviour. Useful follow-on.

**Process-reward / fine-tuning bits**: OUT OF SCOPE per
`AGENTS.md#harness-taxonomy` interface-only-adaptation invariant.

---

## Smart caching for all agents

**Status**: 🚀 ready to ship.

**Why**: operator brain-dump 2026-05-27 — add smart caching across agent
dispatches. Same input → same output via cached response, dramatic cost
drop when agents re-ask the same question (e.g. niche-research,
trend-scouting, audit lookups).

**Scope (1 PR)**:
- New table `agent_response_cache(input_hash text pk, agent_slug text,
  output jsonb, hit_count int, created_at, last_used_at)`.
- `lib/agents/cache.ts` — wraps `executeBusinessAction` + LLM dispatches
  with a `cacheable: true` opt-in flag. Hash inputs deterministically
  (agent_slug + sorted-arguments-json) → `sha256`. TTL configurable per
  call (default 24h).
- Eviction policy: LRU at 10k rows.
- Per-agent opt-in via `cache_policy: 'aggressive' | 'conservative' |
  'off'` in the agent spec frontmatter.

**Why it's an immediate ship**: agent re-ask is a real cost driver.
Same trend-scout query for the same niche fires multiple times per week
across solopreneur-loop cycles. Caching collapses that. Estimated 30-50%
spend reduction on read-mostly agents.

**Track**: implement after R3-R5 (which the operator already approved).

---

## Agents-of-Chaos security audit

**Status**: 🚀 ready to ship.

**Why**: Stanford+Harvard+MIT paper (arXiv:2602.20021) catalogued real
vulnerabilities in autonomous agent deployments. Most of their
recommendations we already have (approval gates, cost-guard, no root
access). Worth a formal audit pass.

**Scope**:
- Use the `security-review` skill to walk every `.claude/agents/*.md`
  spec against the paper's threat model.
- Output: `docs/research/agents-of-chaos-2026-audit.md` with per-agent
  verdict + a small follow-up plan for any gaps.

**Expected gaps**:
- Inter-agent message authentication isn't formally signed.
- Identity-spoofing protection within the operator-gated loop pattern
  is implicit (operator-types-the-prompt) — could be tightened.

---

## Paperclip-prod walkthrough audit

**Status**: 🚀 ready to ship.

**Why**: operator brain-dump — have an AI agent click through
`https://paperclip-production-6b3c.up.railway.app/` and find improvements
for Nexus.

**Scope**:
- Use `firecrawl` skill to map the Paperclip production site (≤20 pages).
- Use `claude-in-chrome` MCP for interactive walkthrough where firecrawl
  can't reach (auth-gated surfaces).
- Output: `docs/research/paperclip-prod-walkthrough-2026.md` with screen-
  by-screen notes + a follow-up list of UX patterns worth porting.

**Caveat**: paperclip-audit-2026-05.md already absorbed Paperclip's
public-repo schema + UI patterns. The prod walkthrough catches anything
they shipped since the repo snapshot or anything live-only (analytics
charts, mobile flows, etc.).

---

## NVIDIA NIM provider adapter

**Status**: 🚀 ready to ship.

**Why**: free tier for developers running NVIDIA-hosted inference. Add
as one of the `LLM_PROVIDER` enum values alongside claude / openrouter /
mimo / ollama.

**Scope (1 PR)**:
- `lib/llm/providers/nim.ts` — adapter mirroring `lib/llm/providers/openrouter.ts`
  shape. NVIDIA NIM exposes an OpenAI-compatible endpoint.
- Add `'nim'` to `LlmProvider` union in `lib/llm/provider.ts`.
- Add to `VALID_PROVIDERS` set in `lib/llm/provider-settings.ts`.
- Operator picks via `/settings → AI providers → switch provider`.

**Use case**: low-stakes background tasks (failure-cluster scan, weekly
digest, content trend-scouting) route through NIM to drop marginal cost
to zero.

---

## Research items

The following are 🔬 research-only — captured for absorption when
priorities surface a use case. Each has a row in
`docs/research/OPEN_SOURCE_ABSORPTIONS.md` with a one-line description.

- **Perplexity Bumblebee** — security-scan agent toolkit. Slots into
  `ops-compliance-checker` as a tool.
- **Skyreels v2** — video model alternative to Higgsfield / Runway /
  Kling.
- **Voxcpm** — expressive voice-cloning. Drops into the content-team's
  `voice` adapter slot.
- **Ruflo** — swarm-tasks tooling for Claude Code. Adjacent to the
  existing `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` swarm path.
- **Plumoai** — research item; scope verification pending.
- **ADHD-simulation MARL paper** — operator brain-dump. Pattern at most:
  "rapid idea generation + AI execution" as a personal-productivity
  axis. Not a platform feature; track as a personal-workflow note.

---

## How this doc relates to other plans

- `task_plan-loops-sprints.md` — sibling, ready-to-implement.
- `task_plan-bloomberg-audit.md` — sibling, ready-to-implement.
- `docs/research/UX_CONSULTATION_2026-05-27.md` — the rank-ordered R1-R12
  list that's currently shipping.
- `docs/research/OPEN_SOURCE_ABSORPTIONS.md` — the canonical absorption
  tracker; every research item here has a row there too.

## Progress

### Items shipped in this PR (the doc-absorption layer)

- [x] OPEN_SOURCE_ABSORPTIONS.md extended with 9 new research entries
  (Halo, Agents-of-Chaos, Perplexity Bumblebee, Plumoai, NIM, Voxcpm,
  Skyreels v2, Ruflo, space-agent).
- [x] `task_plan-loops-sprints.md` scoped + planned.
- [x] `task_plan-bloomberg-audit.md` scoped + planned.
- [x] This doc consolidates the 11 remaining brain-dump items.
- [x] Dark-mode default locked via `color-scheme: dark` in
  `app/globals.css`.

### Awaiting operator priority

The 7 ready-to-implement items (smart caching, Agents-of-Chaos audit,
Paperclip-prod walkthrough, NIM adapter, Loops, Bloomberg audit, and any
deferred-but-scoped item from above) ship in the order the operator
prioritises. Each is a 1-2 PR job.
