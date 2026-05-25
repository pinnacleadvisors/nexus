# task_plan-content-team-higgsfield.md

> **Architectural overlay:** this is one instance of the [departments + ecosystems abstraction](task_plan-departments-and-ecosystems.md). The Content **department** roster below is ecosystem-agnostic; Higgsfield is just the default `video` adapter. Swapping to Runway / Veo / Kling / Pika is a one-config-row change to `teams.ecosystem_bindings`. Read the departments plan first for the adapter contract, the registry, and the v1 scope it ships into.

Goal: A "Content Team" managed-agent roster, anchored on the open Higgsfield video model, that any Nexus business with `niche=creator | ad-agency | personal-brand` can spin up. End-to-end pipeline: trend → concept → shot list → Higgsfield render → edit pass → distribution → performance feedback.

Success criteria:
- One operator command — "spin up the content team for `<business>`" — provisions a new MCP container with the Higgsfield + ElevenLabs + HeyGen + Runway MCPs already wired AND seeds the per-agent specs in `.claude/agents/content-team/*.md`.
- Each agent has ≥ 2 plausible tools per the AGENTS.md tool-budget rule.
- Higgsfield outputs land in R2 with a `business_slug` tag and a row in `experiment_metrics`.
- Performance agent closes the loop: TikTok/YouTube/IG view counts back-propagate as `kpi_observation` rows that the concept agent reads next cycle.
- 100% provider-agnostic check (no model pins in spec bodies).

Hard constraints:
- No new Doppler secrets beyond the existing `HIGGSFIELD_*`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`, `RUNWAY_API_KEY`, `MUAPI_AI_KEY` — they already exist in `memory/platform/SECRETS.md` Phase 18.
- All agents inherit the [Operator-gated loop pattern](AGENTS.md#operator-gated-loop-pattern-ralph-loop) — multi-cycle work emits typed plan blocks, no autonomous publish without an `approval-request`.
- Open Higgsfield mode means: prefer the self-hosted endpoint when `HIGGSFIELD_BASE_URL` is set, fall back to the hosted API otherwise. Endpoint resolution lives in `lib/video/higgsfield.ts` (new).

---

## Phase 1 — Explore (do first)

- Read [`lib/businesses/mcp-manifest.ts`](lib/businesses/mcp-manifest.ts) — `higgsfield`, `runway`, `kling`, `muapi-ai`, `elevenlabs`, `heygen` are already in the catalog.
- Read [`docs/runbooks/per-business-container-rollout.md`](docs/runbooks/per-business-container-rollout.md) — provisioning flow.
- Query memory-hq via `memory_search "higgsfield"` for prior atoms on its API quirks (rate limit, model selection, prompt format).
- Check whether `HIGGSFIELD_BASE_URL` env var exists yet; if not, that's the first PR.

## Phase 2 — Plan (atomic tasks)

### Roster — six agents

| Slug | Role | Tool budget |
|---|---|---|
| `content-trend-scout` | Surfaces 5–10 trend angles/week per niche | tavily, firecrawl, supermemory |
| `content-concept-writer` | Trend → 3 video concepts (hook, shot list, length, target audience) | claude/self, memory_query |
| `content-script-writer` | Concept → narrated script + on-screen text + scene timing | claude/self, memory_query |
| `content-video-builder` | Script → rendered clips (Higgsfield as primary, Runway/Kling as adversarial alts) | higgsfield, runway, kling, muapi-ai |
| `content-edit-publisher` | Clips → final cut (ElevenLabs voiceover, Suno/Udio music, edit) → publishes to TikTok/YT/IG | elevenlabs, heygen, composio (oauth fan-out) |
| `content-perf-analyst` | Reads analytics 24h post-publish → writes `kpi_observation` rows + memory-hq atoms describing what worked | composio (TikTok/YT/IG analytics actions), memory_atom |

### Workflow

1. Operator says "post 5 videos this week for `<business>`".
2. `content-trend-scout` runs nightly, drops trend atoms tagged `content-trends/<niche>`.
3. `content-concept-writer` reads the trend MOC + last 30 days of `kpi_observation` rows, emits 3 concept cards. Operator approves one via the `approval-request` block (gate: `content_concept`).
4. `content-script-writer` → `content-video-builder` → `content-edit-publisher` chain runs as a `claude-session` with `swarm: true` (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1).
5. Pre-publish: a review node renders the asset in the Board for a final human pass.
6. After publish: a 24h scheduled task fires `content-perf-analyst`.

### New artifacts

- `.claude/agents/content-team/{slug}.md` × 6 — fork pattern from [`solopreneur-loop.md`](.claude/agents/solopreneur-loop.md) for the orchestrator parts, lighter sub-agent shape for the workers.
- `lib/video/higgsfield.ts` — single endpoint resolver + retry-storm-safe wrapper. Honors `HIGGSFIELD_BASE_URL` for the open mode.
- `lib/content-team/manifest.ts` — exports `CONTENT_TEAM_MCPS` that the MCP manifest's `niche=creator` profile imports.
- `memory/molecular/mocs/content-team.md` (canonical written to memory-hq) — links every agent atom + the playbook entries.
- Three operator runbooks in `docs/runbooks/content-team/`: `setup.md`, `troubleshooting-higgsfield.md`, `cost-tuning.md`.

### Approval gates (added to `approval_gates` enum)

- `content_concept` — concept selection before script.
- `content_publish` — final cut before posting to the platform.
- `content_creative_brief_change` — material change to the brand voice / template.

Auto-actions (no gate) — trend scouting, script drafting, asset rendering to draft, analytics polling.

## Phase 3 — Implement (per-task PRs)

1. Land `lib/video/higgsfield.ts` + env-var doc (PR 1).
2. Land the six `.claude/agents/content-team/*.md` specs (PR 2 — six specs, ≤ 300 lines each so the write-size hook stays green).
3. Land the manifest + niche-profile wiring (PR 3).
4. Land runbooks + memory atoms (PR 4).
5. Smoke test: provision a test business with `niche=creator`, request "make 1 video", verify the chain runs end-to-end.

## Cost model (rough)

| Stage | Per-video LLM tokens | Per-video media cost |
|---|---|---|
| Trend → concept | ~3 k | $0 |
| Script | ~2 k | $0 |
| Render (5 clips × ~6 s) | n/a | $0.50–$2 (Higgsfield self-hosted: ~$0.05) |
| Voiceover | ~0.5 k | $0.10 (ElevenLabs) |
| Music | n/a | $0.05 (Suno/Udio) |
| Analytics readback | ~1 k | $0 |

`checkKillSwitch()` integration: every step calls it before paid API time. The open Higgsfield mode is what makes the cost model survive a 5× video/week cadence per business.

## Open questions

- Does the open Higgsfield require GPU on the same KVM4 host? If yes → second runbook for `services/higgsfield-render/` container shape.
- Should `content-edit-publisher` be one agent or split (edit vs publish)? Lean toward one — the AGENTS.md tool-budget rule wants ≥ 2 tools per agent, and "edit" + "publish" are naturally adjacent.
