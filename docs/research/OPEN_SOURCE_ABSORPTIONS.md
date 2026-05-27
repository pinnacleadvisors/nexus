# Open-Source Project Absorptions

Single source of truth for which OSS projects Nexus has absorbed patterns from,
what was absorbed, where it lives in this repo, and what's pending.

> **Why this doc exists.** Patterns from Hermes / EvoSkill / Voyager / Paperclip
> are scattered across memory-hq atoms, ADRs, agent specs, and skill folders.
> Until now there was no single answer to "what have we taken from where, and
> where can we find it in code." This file is that answer. Update it whenever
> a new pattern lands or a candidate is rejected.
>
> **Canonical companion stores:**
> - **memory-hq** (`pinnacleadvisors/memory-hq`) — atoms with kind `pattern-absorbed`,
>   linked to `[[mocs/<project>]]`. Query via `memory_search "<project>"`.
> - **`docs/adr/`** — non-obvious absorption decisions (e.g. [`007-paperclip-absorption.md`](../adr/007-paperclip-absorption.md)).
> - **`memory/molecular/entities/<project>.md`** — short bios per absorbed project.

## Status legend

| Symbol | Meaning |
|---|---|
| ✅  | **Absorbed** — pattern is live in Nexus; cited file paths work today. |
| 🟡  | **Partial** — some patterns absorbed, others rejected or pending. |
| 🔬  | **Candidate** — paper / repo evaluated, absorption not yet executed. Linked plan tracks the work. |
| ❌  | **Rejected** — evaluated and consciously declined. Reason captured below. |

---

## Projects

### Hermes &nbsp;✅
- **Source:** [arxiv (Hermes paper)] / agent-framework community
- **Entity:** [`memory/molecular/entities/hermes.md`](../../memory/molecular/entities/hermes.md)
- **Plan disposition:** [`task_plan-hermes-agent.md`](../../task_plan-hermes-agent.md) — CLOSED 2026-05-23, operator picked option C "already absorbed"

| Pattern absorbed | Lives at | Atom |
|---|---|---|
| Autonomous SKILL.md authoring with YAML frontmatter | [`.claude/skills/*/SKILL.md`](../../.claude/skills/) + [`.claude/hooks/skill-router.sh`](../../.claude/hooks/skill-router.sh) | [`hermes-frontmatter-skill-routing-absorbed`](../../memory/molecular/atoms/hermes-frontmatter-skill-routing-absorbed.md) |
| 3-tier light-index recall (frontmatter → open file on demand) | [`memory/molecular/INDEX.md`](../../memory/molecular/INDEX.md) + the `[[wikilink]]` pattern across MOCs | [`hermes-3-tier-light-index-recall-absorbed`](../../memory/molecular/atoms/hermes-3-tier-light-index-recall-absorbed.md) |
| System-wide rollback via git stash + worktree | [`docs/runbooks/git-multi-agent-collaboration.md`](../runbooks/git-multi-agent-collaboration.md) | [`hermes-system-wide-rollback-absorbed`](../../memory/molecular/atoms/hermes-system-wide-rollback-absorbed.md) |

Rejected options (paper trail in plan doc): A — dedicated `hermes` agent + Coolify sidecar; B — running upstream Hermes as another runtime.

---

### EvoSkill &nbsp;✅
- **Source:** EvoSkill agent framework
- **Entity:** [`memory/molecular/entities/evoskill.md`](../../memory/molecular/entities/evoskill.md)

| Pattern absorbed | Lives at | Atom |
|---|---|---|
| Proposer → evaluator → 3-consecutive-passes loop | [`.claude/agents/skill-trainer.md`](../../.claude/agents/skill-trainer.md) + [`app/api/sandbox/exec/route.ts`](../../app/api/sandbox/exec/route.ts) + [`services/nexus-sandbox/`](../../services/nexus-sandbox/) | [`evoskill-proposerevaluator-loop-absorbed`](../../memory/molecular/atoms/evoskill-proposerevaluator-loop-absorbed.md) |
| Git-branched skill versioning | `.claude/skills/<name>/` directories tracked per branch; ReviewModal "Promote draft → verified" via [`app/api/skills/[slug]/promote/route.ts`](../../app/api/skills/[slug]/promote/route.ts) | [`evoskill-git-branched-skill-versioning-absorbed`](../../memory/molecular/atoms/evoskill-git-branched-skill-versioning-absorbed.md) |

---

### Voyager &nbsp;✅
- **Source:** Voyager (MineDojo / OpenAI follow-on work)
- **Entity:** [`memory/molecular/entities/voyager.md`](../../memory/molecular/entities/voyager.md)

| Pattern absorbed | Lives at | Atom |
|---|---|---|
| Iterative curriculum — progressively harder skill tasks chained against a growing library | [`.claude/agents/skill-trainer.md`](../../.claude/agents/skill-trainer.md) curriculum brief format | [`voyager-iterative-curriculum-absorbed`](../../memory/molecular/atoms/voyager-iterative-curriculum-absorbed.md) |

---

### Paperclip (paperclipai/paperclip) &nbsp;🟡
- **Source:** [`paperclipai/paperclip`](https://github.com/paperclipai/paperclip) (MIT, 67K stars at audit time)
- **ADR:** [`docs/adr/007-paperclip-absorption.md`](../adr/007-paperclip-absorption.md)
- **Audit:** [`docs/research/paperclip-audit-2026-05.md`](paperclip-audit-2026-05.md)
- **Plan:** [`task_plan-paperclip-absorption.md`](../../task_plan-paperclip-absorption.md) (Phase 1 ✅, Phases 2-4 pending)

| Pattern absorbed | Lives at | Status |
|---|---|---|
| Schema absorption — `companies` / `goals` / `issues` / `approvals` shapes | Migrations 046-050 | ✅ |
| `companies`-as-first-class default surface | [`app/(protected)/companies/`](../../app/(protected)/companies/) | ✅ partial (multi-tenant view pending Phase 3) |
| `create_business` chat-consultant agent (replaces static `/idea`) | [`.claude/agents/create-business.md`](../../.claude/agents/create-business.md) + [`app/(protected)/businesses/new/page.tsx`](../../app/(protected)/businesses/new/page.tsx) | ✅ |
| Approval inbox at `/inbox` (single approval queue across businesses) | [`app/(protected)/inbox/`](../../app/(protected)/inbox/) | ✅ |
| Single-assignee + `checkoutRunId` vs `executionRunId` invariant on issues | Migrations 048, 050, 051 | ✅ |
| Adapter architecture (`claude_local`, `codex_local`, `hermes_local`, …) | Pending Phase 4 | 🔬 |
| `BudgetIncidentCard` / `BillerSpendCard` / `CommentThread` / `BreadcrumbBar` | Pending Phase 3 | 🔬 |
| Heartbeat scheduling visualisation | Pending [`task_plan-paperclip-ui-phase-2.md`](../../task_plan-paperclip-ui-phase-2.md) Task E | 🔬 |

Rejected: full Paperclip migration (loses cost-guard / Composio / niche-MCP / 5-category gate / memory-hq differentiators).

---

### OpenClaw &nbsp;🟡
- **Source:** OpenClaw agent gateway (proprietary; pre-Claude-Max)
- **Entity:** [`memory/molecular/entities/openclaw.md`](../../memory/molecular/entities/openclaw.md)

| Pattern absorbed | Lives at | Status |
|---|---|---|
| Self-hosted Claude proxy with bearer-token auth | [`services/claude-gateway/`](../../services/claude-gateway/) replaces it; OpenClaw kept as deprecated fallback | ✅ |
| Streaming dispatch with cost telemetry | [`app/api/claude-session/dispatch/route.ts`](../../app/api/claude-session/dispatch/route.ts) | ✅ |

Status: **superseded by `claude-gateway`.** Env-only `OPENCLAW_GATEWAY_URL` fallback retained until pilot rollout completes (per `task_plan-execution-overhaul.md`).

---

### OpenSwarm &nbsp;🟡
- **Source:** OpenAI Swarm + community forks
- **Entity:** [`memory/molecular/entities/openswarm.md`](../../memory/molecular/entities/openswarm.md)

| Pattern absorbed | Lives at | Status |
|---|---|---|
| Swarm pattern for multi-agent parallel work | [`.claude/agents/pdf-swarm-lead.md`](../../.claude/agents/pdf-swarm-lead.md) — Claude Code Agent Teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) | ✅ |
| Swarm view UI (Kanban-style sub-task tracking) | [`components/chat-views/`](../../components/chat-views/) (Phase 5 v2, PR #297) | ✅ |

---

### Mimo &nbsp;🔬
- **Source:** Mimo open-source local-LLM serving stack
- **Entity:** [`memory/molecular/entities/mimo.md`](../../memory/molecular/entities/mimo.md)

| Pattern absorbed | Lives at | Status |
|---|---|---|
| OpenAI-compatible provider switch | [`lib/llm/providers/mimo.ts`](../../lib/llm/providers/mimo.ts) — stub | 🔬 awaits Claude-Max-end pivot |

---

### Higgsfield &nbsp;❌
- **Source:** Higgsfield (video gen)
- **Entity:** [`memory/molecular/entities/higgsfield.md`](../../memory/molecular/entities/higgsfield.md)
- **Disposition:** Evaluated for Phase 18 video stack; superseded by Kling / Runway / HeyGen / D-ID per `memory/platform/SECRETS.md`.

---

### Continual Harness (Princeton + Google DeepMind) &nbsp;🔬
- **Source:** Karten et al., ["Continual Harness: Online Adaptation for Self-Improving Foundation Agents"](https://arxiv.org/abs/2605.09998) (arXiv 2605.09998)
- **Repo:** [`sethkarten/continual-harness`](https://github.com/sethkarten/continual-harness) (MIT, last updated 2026-05-24)
- **Plan:** [`task_plan-harness-absorption.md`](../../task_plan-harness-absorption.md)

Candidate patterns (operator approval pending):

| Pattern | What it means for Nexus | Status |
|---|---|---|
| Reset-free online adaptation | `business-operator` is already long-running; absorption is the agent EDITING ITS OWN spec/skills/hooks mid-cycle with operator gates | 🔬 |
| Self-refining component hierarchy (prompt / sub-agents / skills / memory as 4 first-class targets) | Map to Nexus's 4 surfaces: `agent_library.hooks` ≈ prompt, `.claude/agents/` ≈ sub-agents, `.claude/skills/` ≈ skills, memory-hq ≈ memory | 🔬 |
| Long-context memory as introspection channel | Already present (memory-hq atoms read by every agent) — formalise the "reflect on own past trajectories" prompt | 🔬 |
| Process-reward co-learning loop (frontier teacher relabels rollouts → updates open-source model) | ❌ rejected — we don't train models | n/a |

Repo structure relevant to absorption: `System-Design/architecture/`, `agents/`, `utils/agent_infrastructure/`, `utils/data_persistence/`, `utils/stores/`.

---

### Life-Harness (Peking University) &nbsp;🔬
- **Source:** Xu, Wen, Li, ["Adapting the Interface, Not the Model: Runtime Harness Adaptation for Deterministic LLM Agents"](https://arxiv.org/abs/2605.22166) (arXiv 2605.22166)
- **Repo:** [`Tianshi-Xu/Life-Harness`](https://github.com/Tianshi-Xu/Life-Harness)
- **Plan:** [`task_plan-harness-absorption.md`](../../task_plan-harness-absorption.md)

Candidate patterns (operator approval pending):

| Pattern | What it means for Nexus | Status |
|---|---|---|
| **Interface-only adaptation (freeze model)** | Already aligns with Nexus philosophy. Make it explicit as an architectural invariant. | 🔬 |
| **4-layer harness taxonomy** — `h2` action realization, `h3` environment contract, `h4` trajectory regulation, `h5` procedural skill | Adopt as canonical organization. Map: `h2`→MCP tool wrappers, `h3`→[`lib/businesses/mcp-manifest.ts`](../../lib/businesses/mcp-manifest.ts) + tool budgets, `h4`→operator-gated loop pattern + permission_prompt + edit-plan, `h5`→`.claude/skills/` | 🔬 |
| **Failure → intervention conversion** (automatic distillation from trajectories) | Extend [`workflow-optimizer`](../../.claude/agents/workflow-optimizer.md) to scan `run_events.outcome='error'` clusters and propose hook/skill diffs (today it only reads human feedback) | 🔬 |
| **Cross-model transferability** (Qwen3-4B → 17 other models, 88.5% avg improvement) | Already supported via `LLM_PROVIDER` switch — document explicitly that hooks/skills must remain LLM-agnostic + add a `check:provider-agnostic` static check | 🔬 |
| **Fixed-during-evaluation design** | Useful pattern — freeze hooks during a "release window", only allow agent-proposed diffs during a "training window" | 🔬 |

Repo structure: `AgentBench/`, `TauBench/` — Docker + uv task harnesses with the 4 layer flags `h2/h3/h4/h5`.

---

### Halo (context-labs/halo) &nbsp;🔬

Self-improving harness for production agent deployments. Operator brain-dump 2026-05-27.

| Pattern | Verdict | Status |
|---|---|---|
| Continuous evaluation loop in production | Useful — extends our `workflow-optimizer` failure-cluster pattern with online feedback rather than purely scheduled | 🔬 |
| Online A/B of prompt + tool-call variants | Useful — adjacent to our LLM-voice A/B work but for agent behaviour | 🔬 |
| Eval harness mounted into the live agent runtime | Useful — slots into the h4 layer of the Life-Harness taxonomy | 🔬 |
| Direct context modification / fine-tuning | OUT OF SCOPE — we keep weights frozen per AGENTS.md "Interface-only adaptation" | ❌ |

Next step: `task_plan-halo-absorption.md` planning doc. Repo: github.com/context-labs/halo.

### Agents of Chaos (arXiv:2602.20021) &nbsp;🟡

Stanford + Harvard + MIT — gave autonomous agents real tools (email, shell, Discord, memory) and watched them leak data + execute destructive commands + comply with attackers. Operator surfaced 2026-05-27. Most of the paper's recommendations Nexus already has, but the audit is worth running formally.

| Pattern | Nexus state | Verdict |
|---|---|---|
| Restrict tool execution (no root/bash, human-in-loop for destructive) | ✅ Approval gates + `simulationGuard` + cost-guard kill-switch all enforce this | ✅ absorbed |
| Strict data governance (no PII scraping, no internal config) | ✅ Composio brokers OAuth tokens; we hold only `composio_account_id`. memory-hq atoms forbid PII per AGENTS.md write rules | ✅ absorbed |
| Verify agent communication (digital signatures, out-of-band confirmation) | 🟡 partial — HMAC bearer on gateway dispatch + Clerk session on chat. No multi-channel out-of-band yet | 🔬 |
| Continuous monitoring + kill-switches (terminate on resource spike) | ✅ cost-guard kill-switch + `/api/health/deep` + Sentry alerts | ✅ absorbed |
| Identity spoofing protection (agent collusion, conversational manipulation) | 🟡 partial — operator-gated loop pattern stops the loop from "convincing itself", but inter-agent message authentication isn't formally signed | 🔬 |

Next step: run a `security-review` skill pass against the 30+ agent specs using this paper's threat model. Track gaps as a follow-up.

### Perplexity Bumblebee &nbsp;🔬

Security-scan agent toolkit from Perplexity. Operator brain-dump 2026-05-27.

| Pattern | Verdict | Status |
|---|---|---|
| Dependency-CVE scanning into the agent's daily loop | Useful for `ops-compliance-checker` (already exists, no scan tool wired) | 🔬 |
| Secret-exposure scan over the codebase | Useful — adjacent to our `check:codeql-patterns` clear-text-logging rule | 🔬 |
| Threat-model-as-a-prompt | Useful — extends the `security-review` skill | 🔬 |

Verdict so far: most useful as a tool the `ops-compliance-checker` or `security-review` skill calls, NOT a new agent. Track in `task_plan-security-scan-tooling.md`.

### Plumoai &nbsp;🔬

Operator brain-dump 2026-05-27 — research item only, no specific pattern identified yet. Likely an alternative LLM provider / agent runtime. Verify scope before deciding absorption.

### NVIDIA NIM &nbsp;🔬

Free API tier for developers running NVIDIA's hosted inference. Operator brain-dump 2026-05-27.

| Pattern | Verdict | Status |
|---|---|---|
| Add as one of the `LLM_PROVIDER` enum values (alongside claude / openrouter / mimo / ollama) | Useful — falls through the existing provider abstraction at `lib/llm/provider.ts` | 🔬 |
| Use free tier for low-stakes background tasks (failure-cluster scan, weekly digest) | Useful — drops marginal cost to zero for non-customer-facing dispatches | 🔬 |

Next step: add `lib/llm/providers/nim.ts` adapter (mirrors `openrouter.ts` shape). One-PR job. Track as `task_plan-nim-adapter.md`.

### Voxcpm &nbsp;🔬

Expressive voice-cloning model. Operator brain-dump 2026-05-27. Drops into the content-team's `voice` adapter slot alongside ElevenLabs.

Track as `task_plan-voxcpm-voice-adapter.md`.

### Skyreels v2 &nbsp;🔬

Operator brain-dump 2026-05-27. Likely a video model alternative to Higgsfield / Runway / Kling. Slots into the content-team's `video` adapter array. Verify scope + license before absorption.

### Ruflo &nbsp;🔬

Swarm-tasks tooling for Claude Code. Operator brain-dump 2026-05-27. Adjacent to the existing `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` swarm path. Verify whether it adds new capability beyond Anthropic's native team-spawn.

### space-agent (agent0ai/space-agent) &nbsp;🔬

Per-business UI customisation framework. Operator brain-dump 2026-05-27 — fork candidate for "operator paints custom dashboards". Track in `task_plan-custom-dashboard-widgets.md`.

---

## Nexus-originated patterns (cross-referenced)

These were NOT absorbed from elsewhere — they're our own. Documented here so the
two columns ("absorbed from" / "originated by Nexus") are easy to compare.

| Pattern | Lives at | Atom |
|---|---|---|
| Lean-mode pivot via feature flag (not branch fork) | [`lib/lean-mode.ts`](../../lib/lean-mode.ts) | [`lean-mode-pivot-via-feature-flag-not-branch-fork-nexus-pattern`](../../memory/molecular/atoms/lean-mode-pivot-via-feature-flag-not-branch-fork-nexus-pattern.md) |
| Rootless-podman sandbox for closed upskilling loop | [`services/nexus-sandbox/`](../../services/nexus-sandbox/) + [`app/api/sandbox/exec/route.ts`](../../app/api/sandbox/exec/route.ts) | [`rootless-podman-sandbox-for-closed-upskilling-loop-nexus-pattern`](../../memory/molecular/atoms/rootless-podman-sandbox-for-closed-upskilling-loop-nexus-pattern.md) |
| 5-category gate matrix (irreversible-strategic-only autonomy) | [`.claude/agents/solopreneur-loop.md`](../../.claude/agents/solopreneur-loop.md) | (see solopreneur-loop spec) |
| Composio Doppler broker (one-shot secret-gated commands) | [`.claude/agents/doppler-broker.md`](../../.claude/agents/doppler-broker.md) + [`docs/adr/001-composio-doppler-broker.md`](../adr/001-composio-doppler-broker.md) | (see ADR) |
| Codex gateway sandbox (execution-heavy work without secret exposure) | [`services/codex-gateway/`](../../services/codex-gateway/) + [`docs/adr/002-codex-gateway-sandbox.md`](../adr/002-codex-gateway-sandbox.md) | (see ADR) |

---

## How to update this doc

When you absorb a new pattern OR reject a candidate:

1. Add or update the row in the relevant project section.
2. Write a `memory_atom` with `kind: pattern-absorbed` linked to `[[mocs/<project>]]` so other agents see it via `memory_search`.
3. If the absorption changes architectural direction, add an ADR (`docs/adr/NNN-...md`).
4. If a candidate is rejected, leave the row with status ❌ + a one-line "Reason" — the paper trail is more useful than a deleted row.

The `check:agent-spec-freshness` cadence (90-day re-read) covers `.claude/agents/*` but does NOT cover this doc. If an absorption row is more than 6 months stale (no commits to the cited files since), consider whether the pattern is still live.
