# task_plan — Hermes agent (deferred from mobile-copilot Phase 3)

> Captured during the Phase 3 wrap-up of [`task_plan-mobile-copilot.md`](task_plan-mobile-copilot.md). The operator listed "docker for hermes agent" as a deferred item. The reference is **ambiguous** — Nexus has absorbed several patterns *from* the Hermes agent framework (see [`memory/molecular/entities/hermes.md`](memory/molecular/entities/hermes.md)) but has no agent named "hermes" in `.claude/agents/`. This plan flags the disambiguation needed before any code is written.

## North Star — pending operator clarification

**Goal candidates** (operator picks one before kickoff):

1. **(A) Dedicated Nexus "hermes" agent** — a new managed agent in `.claude/agents/hermes.md` that embodies the three Hermes patterns Nexus has absorbed: autonomous SKILL.md authoring with frontmatter index, 3-tier light-index recall, system-wide rollback via git stash. Containerized via a new `services/hermes-gateway/` (sibling to `claude-gateway` and `codex-gateway`). Runs on its own Coolify resource.

2. **(B) Hermes framework itself, dockerized** — adopt the upstream Hermes project (if there's a usable open-source release) and run it as another runtime alongside Claude / Codex. The platform-copilot or solopreneur-loop would route to it via a new MCP delegate.

3. **(C) The hermes patterns already absorbed are enough** — no new agent or container needed. The plan doc closes as "WontFix" with a one-liner pointing at the existing molecular-memory entries on absorbed patterns.

Until the operator picks one, this plan stays in `Proposed` status. The bullets below are inputs to the decision, not commitments.

## Background — what Nexus already absorbed from Hermes

Per memory-hq atoms (canonical scope: `pinnacleadvisors/nexus`):

- [`hermes-frontmatter-skill-routing-absorbed`](memory/molecular/atoms/hermes-frontmatter-skill-routing-absorbed.md) — `.claude/skills/<slug>/SKILL.md` with YAML frontmatter is what `skill-router.sh` reads to suggest skills; this pattern shipped via the existing hook.
- [`hermes-3-tier-light-index-recall-absorbed`](memory/molecular/atoms/hermes-3-tier-light-index-recall-absorbed.md) — the read-frontmatter-first, then-open-file-on-demand pattern is mirrored in `memory/molecular/INDEX.md` + the `[[wikilink]]` pattern in MOCs.
- [`hermes-system-wide-rollback-absorbed`](memory/molecular/atoms/hermes-system-wide-rollback-absorbed.md) — git stash + worktree-based rollback is documented in `docs/runbooks/git-multi-agent-collaboration.md`.

If the operator picks option (C) above, the plan is closed.

## Decision criteria for (A) vs (B) vs (C)

Operator confirms which question matters most:

- **(A) is correct if**: the operator wants an in-Nexus agent that exposes Hermes-style autonomous skill authoring as a chat-driven workflow (e.g. "platform-copilot, draft a new SKILL.md for X and lint it"). Effort: ~1 week. Gateway dockerization follows the existing claude-gateway recipe.
- **(B) is correct if**: there's an upstream Hermes binary the operator wants to evaluate in production. Effort: ~2 weeks (research + container + MCP delegate + cost-guard wiring). Higher risk.
- **(C) is correct if**: the operator's intent was "remember to keep applying Hermes patterns" — already done.

## Atomic tasks — gated on operator picking (A)

These are placeholders. Do not execute until the operator confirms goal (A).

### Task H1 — Hermes agent spec (`.claude/agents/hermes.md`)
- Frontmatter: tools = Read, Edit, Write, Bash, Grep, Glob; model = sonnet (Hermes patterns favor narrower context; opus is overkill).
- System prompt: focused on autonomous SKILL.md authoring + 3-tier recall + git-stash rollback. Cross-references the three absorbed atoms.
- Approval gates: same Ralph-loop invariants as bug-hunt-loop — no autonomous writes to `.claude/skills/`, only proposals via `approval-request` blocks.

### Task H2 — `services/hermes-gateway/` container
- Fork `services/claude-gateway/Dockerfile` as the starting point.
- Drop financial / Coolify MCP servers (Hermes doesn't need them).
- Add Hermes-specific MCP if option (B) is co-pursued.

### Task H3 — Cost-guard wiring + kill-switch
- `checkKillSwitch(null)` on every dispatch.
- `USER_DAILY_USD_LIMIT` already covers it — no new envelope.

### Task H4 — MCP delegate from platform-copilot
- New `mcp__hermes-delegate__delegate_to_hermes` registered in claude-gateway entrypoint when `HERMES_GATEWAY_URL` is set.
- Platform-copilot routes "draft a skill for X" or "audit skill discovery" prompts to Hermes.

### Task H5 — Memory atom + ADR
- ADR documenting why option (A) over (B)/(C).
- Atom + entity for the hermes agent in memory-hq.

## Risks (any option)

- The naming collision between "Hermes pattern" (the design philosophy Nexus already absorbed) and "Hermes agent" (the proposed new container) will cause confusion in chat history and atoms. Mitigation: pick distinctive names — e.g. `.claude/agents/skill-author.md` instead of `hermes.md` if option (A) goes ahead.
- Adding a fourth gateway (claude / codex / per-business / hermes) is a topology cost; review against ADR 002 before committing.

## Progress

### Completed
- [x] This disambiguation plan written.

### Awaiting operator
- [ ] Pick (A), (B), or (C) above.
