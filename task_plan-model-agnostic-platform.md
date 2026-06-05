# Model-agnostic platform — agents, skills, MCP, hooks

> ⚠️ **DEMOTED 2026-06-04 — re-scope against ADR 012.** The lean-Nexus integration-cockpit pivot
> ([ADR 012](docs/adr/012-lean-nexus-integration-cockpit.md)) selects **opencode** (75+ providers) +
> **Hermes** as the model-agnostic runtimes, and the sibling `task_plan-model-agnostic-chat.md` is
> already superseded. Most of this plan's "shim every runtime" scope is now provided by opencode
> by design. **Action before resuming:** keep only the genuinely-Nexus overlay (provider-neutral
> agent/skill specs + the `check:provider-agnostic` guard, which shipped) and drop the per-runtime
> shim work. Live successor: the `workforce-lab` RUN experiment. Kept for history.

Sibling to `task_plan-model-agnostic-chat.md` (which focuses on the streaming chat copilots specifically). This plan covers the entire platform's relationship to a specific provider — today every spec lives under `.claude/`, which encodes the assumption that Claude Code is the runtime. Other runtimes (Codex CLI, OpenCode, Cursor, Cline, future Gemini CLI) either need explicit shims or are blocked entirely.

The fix is **overlay-based**: provider-neutral specs at the repo root, provider-specific overrides nested under each runtime's hidden folder. Resolution order: provider-specific override → base. The change is additive — `.claude/` stays exactly as Claude Code expects it, but the base specs become the authority and other runtimes can read from the same root.

## Comparison with OpenCode (sst.dev/opencode)

OpenCode's layout — for reference:

```
opencode.json          ← provider config + tools + MCP
agents/<name>.md       ← agent specs at top-level (provider-neutral)
commands/<name>.md     ← slash commands
```

OpenCode picks **one** provider per session and routes everything through it. Their core architectural moves we're already aligned on:
- Top-level `agents/<name>.md` (rather than `.claude/agents/`)
- MCP-as-standard for tool integration
- Configuration-driven provider switching

Where this plan goes **further** than OpenCode toward model-agnosticism:

1. **Multi-provider routing per task type** — OpenCode picks one provider per session. Nexus already routes execution-heavy work (Codex) vs design-heavy work (Claude) per `ADR 002`; we want this same routing surface for any provider, decided per dispatch not per session.
2. **Provider-specific overlay overrides** — OpenCode treats each provider as interchangeable. Reality: a system prompt that's perfect for Claude is often suboptimal for GPT-5.5 or Gemini. The overlay pattern (`agents/<slug>.md` base + `.claude/agents/<slug>.md` override) lets each runtime tune without forking the spec.
3. **Schema-first typed-block emission** (covered separately in `task_plan-model-agnostic-chat.md`) — block parsing decoupled from any one model's natural-output idioms.
4. **Tool budget enforcement** (already in AGENTS.md) — every dispatch carries `inputs.tools: ≥2 plausible options`, forcing the runtime to choose rather than hard-coding. Codified at the spec layer, not the provider layer.
5. **Per-business provider preferences** (shipped in PR #242) — operator can pick tier/mode per provider via Settings → AI Providers. Backed by user_secrets metadata.

The combination is: **Nexus is a multi-provider orchestrator where each provider gets the SAME base spec plus its own tuning, and the routing layer decides which provider gets each turn.** OpenCode is a single-provider runtime where the provider can be swapped wholesale. Different design center.

## North Star

**Goal:** Every provider-neutral specification (agent, skill, MCP server config) lives at the repo root in a top-level directory. Provider-specific runtimes (Claude Code, Codex CLI, future Gemini/Cursor/etc.) read from the base AND apply their own overrides if present. Adding a new provider becomes a one-file change per agent that needs tuning, not a fork of every spec.

**Success criteria:**
- `/agents/<slug>.md`, `/skills/<name>/SKILL.md`, `/mcp/registry.json` exist and are the canonical source of truth.
- Both `claude-gateway` and `codex-gateway` resolve agent specs via overlay: try `.claude/agents/<slug>.md` (or `.codex/`), fall back to `/agents/<slug>.md`. Backward compatible — pre-existing `.claude/agents/*.md` paths keep working through the fallback.
- All 19 existing agent specs migrated from `.claude/agents/` to `/agents/`. `.claude/agents/` only contains genuine Claude-only overrides (if any).
- All 3 existing skills migrated. Skills tab UI reads from the new location.
- MCP server list extracted from `.claude/settings.json`'s `mcpServers` block into `/mcp/registry.json`. Both Claude Code (via `settings.json` referencing the registry) and Codex (via a new loader) consume it.
- A new provider (e.g. hypothetical `gemini-cli`) can be added in one PR with only an adapter file + maybe 1-2 override specs.

**Hard constraints:**
- Backward compatibility — existing `.claude/agents/*.md` paths must keep working through the entire migration. Operator should never see a broken agent.
- No regression on agent generation (`POST /api/agents`) — the agent-generator MUST write to the new `/agents/` location.
- No regression on Skills tab UI from PR #243.
- `.claude/settings.json` and `.claude/hooks/` STAY where they are — Claude Code CLI auto-discovers them by convention. Don't move them.
- Tool budget rule from AGENTS.md (≥2 plausible tools per agent) stays enforced regardless of where specs live.

## Phase 1 — Explore (2026-05-21, done in chat)

Already mapped:
- `services/claude-gateway/src/agentSpec.ts:21` — reads `.claude/agents/<slug>.md`, strips frontmatter
- `services/codex-gateway/src/agentSpec.ts:22` — same shape, same path
- 19 agent specs in `.claude/agents/*.md`
- 3 skills in `.claude/skills/<name>/SKILL.md`
- MCP servers registered in `.claude/settings.json` `mcpServers` block
- Skills tab UI (`/api/skills`) reads `.claude/skills/`
- Agent generator (`POST /api/agents` → `agent-generator`) writes to `.claude/agents/`

## Phase 2 — Plan

### Task MA1 — Overlay resolver in both gateways (foundation)

- **Files:** `services/claude-gateway/src/agentSpec.ts`, `services/codex-gateway/src/agentSpec.ts`
- **Change:** Update `readAgentSystemPrompt(repoPath, slug)` to try paths in this order:
  1. `<repoPath>/.claude/agents/<slug>.md` (Claude-specific override)
  2. `<repoPath>/agents/<slug>.md` (provider-neutral base)
  3. Return null if neither exists
  Codex gateway uses the SAME function but the override path becomes `<repoPath>/.codex/agents/<slug>.md` (a separate folder so the two runtimes don't pollute each other's overrides).
- **Verify:** Unit test against a fixture repo with `agents/foo.md` only (returns that), with both (returns the override), with neither (returns null).
- **Parallel:** no (foundation for MA2-MA5).
- **Risk:** breaks the existing `.claude/agents/` reads if not done carefully. Mitigation: keep the existing path as the override location for Claude — no agent file moves yet, so existing behavior is preserved.

### Task MA2 — Move 19 agent specs from `.claude/agents/` to `/agents/`

- **Files:** rename `.claude/agents/*.md` → `/agents/*.md` via `git mv` (preserves history).
- **Change:** Mechanical. Each file becomes the provider-neutral base. The Claude-specific frontmatter (`model`, `tools`, `isolation`) stays — Codex's loader will read what it can and ignore the rest, OR we strip those fields in a Codex-specific overlay if they conflict.
- **Verify:** After the move, `git mv` history shows the rename. Both gateways can still load every agent by slug. The agent-generator (`POST /api/agents`) writes to the new path.
- **Parallel:** yes (depends only on MA1).
- **Risk:** any code that hardcodes `.claude/agents/` paths breaks. Grep for that exact string across the codebase before the move; fix any callers to use a helper from the gateway's `agentSpec.ts`.

### Task MA3 — Move 3 skills from `.claude/skills/` to `/skills/`

- **Files:** `git mv .claude/skills/* /skills/`, update `app/api/skills/route.ts` to read from the new path AND the old path (for backward compat during transition).
- **Change:** Mechanical, similar to MA2. The Settings → Skills tab keeps working because the route lists both directories.
- **Verify:** Skills tab in production shows the same 3 skills. New skills created by `skill-trainer` agent land in `/skills/`.
- **Parallel:** yes (independent surface from MA2).

### Task MA4 — Extract MCP server list into `/mcp/registry.json`

- **Files:** new `/mcp/registry.json` (canonical list), `.claude/settings.json` (continues to register the same servers but reads from `/mcp/registry.json` via a build-time generator OR is left as a duplicated source for now — Claude Code can't read external files).
- **Change:** Schema: `{ servers: [{ name, command, args, env_vars: string[], description }] }`. Codex gateway gets a new loader that reads this registry and registers each server with its MCP CLI surface (already supported by the MCP SDK).
- **Verify:** `cat /mcp/registry.json | jq '.servers | length'` matches the count in `.claude/settings.json`. Codex gateway boots with all the same MCP servers registered.
- **Parallel:** yes.
- **Risk:** drift between `.claude/settings.json` and `/mcp/registry.json` if both are edited. Mitigation: a tiny `scripts/check-mcp-registry-drift.mjs` runs in pre-commit, compares the two, refuses commit if they diverge.

### Task MA5 — Runtime hooks abstraction (deferred)

- **Files:** `.claude/hooks/*.sh` stays as-is for Claude Code CLI. For Codex (and future runtimes) we'd add `.codex/hooks/*.sh` mirroring the Claude versions — but this is a LOT of work for unclear payoff.
- **Verdict:** **defer this task** unless a concrete pain point emerges. Most platform behavior is enforced server-side (cost-guard, retry-storm checks) rather than client-side hooks. The `check-write-size.sh` PreToolUse hook is the one that matters; it lives in the runtime's tool surface, not the spec layer.
- **Parallel:** N/A (deferred).

### Task MA6 — Documentation + reference updates

- **Files:** `CLAUDE.md`, `AGENTS.md`, `docs/agents/GENERATION_PROTOCOL.md`, `memory/platform/ARCHITECTURE.md`, `memory/INDEX.md`.
- **Change:** Every reference to `.claude/agents/`, `.claude/skills/`, `.claude/settings.json` `mcpServers` block gets a one-line note: "canonical = `/agents/`, `/skills/`, `/mcp/registry.json`. The `.claude/` overrides are for Claude-only tuning."
- **Verify:** `git grep '\.claude/agents'` returns only `.claude/agents/*.md` paths in agent specs themselves OR places that genuinely need Claude-specific paths (settings.json discovery). Other refs point at the canonical base.
- **Parallel:** yes (depends on MA2-MA4 landing).

### Task MA7 — Agent-generator writes to new location

- **Files:** `.claude/agents/agent-generator.md` (this agent's own spec — eventually moves too), `docs/agents/GENERATION_PROTOCOL.md`, `app/api/agents/route.ts`.
- **Change:** The `agent-generator` agent's instructions and the API route both target `/agents/<slug>.md` going forward. New agents land in the canonical location, not the Claude override folder.
- **Verify:** Create a test agent via the API. Confirm it lands in `/agents/`, not `.claude/agents/`.
- **Parallel:** yes (depends on MA2).

## Out-of-scope (explicit)

- **Move `.claude/settings.json` and `.claude/hooks/`** — these are Claude-Code-CLI-specific by convention. Keep them. The MCP server registry inside `settings.json` becomes the OUTPUT of `/mcp/registry.json` (generated at commit time) rather than the source of truth.
- **Build a `.codex/` overlay layer pre-emptively** — only add `.codex/agents/<slug>.md` files when a SPECIFIC agent needs Codex-specific tuning. Don't fork all 19 just because we can.
- **Unify frontmatter schemas across providers** — keep Claude-shaped frontmatter on the base specs. Codex's loader ignores unknown fields. Future providers add their own override specs if frontmatter incompatibility becomes a real problem.
- **Migrate `services/{claude,codex}-gateway/src/spawn.ts`** — they're already provider-specific by design; that's the whole point of having two gateways. Don't try to unify them — ADR 002 is the rationale.

## Sequencing

```
Week 1     MA1 (overlay resolver — both gateways)         ← unblocks everything
Week 1     MA2 (move 19 agents)                            ← parallel, mechanical
Week 1-2   MA3 (move 3 skills + UI)                        ← parallel, mechanical
Week 2     MA4 (MCP registry extraction + Codex loader)
Week 2     MA7 (agent-generator writes to /agents)
Week 2-3   MA6 (docs + reference cleanup)
Later      MA5 (hooks abstraction — defer until needed)
```

Total ~2-3 calendar weeks. Each task is reviewable as its own PR. MA1 lands first as the safety net, then MA2-MA3-MA4 can land in any order.

## Progress

_None yet — plan written 2026-05-21. Task MA1 implementation lands in the same PR as this doc as proof-of-concept; MA2-MA7 await operator approval on the design._
