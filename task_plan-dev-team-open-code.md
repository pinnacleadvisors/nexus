# task_plan-dev-team-open-code.md

Goal: An "Engineering Department" managed-agent roster, anchored on Open Code (the open-source analogue to Claude Code / Codex), that any Nexus business with a code-bearing product (`niche=saas | info-product | ad-agency-with-internal-tools`) can spin up. End-to-end pipeline: brief → architecture → implementation → review → tests → deploy → on-call.

This is the third of three team plans. Like its siblings, it's ecosystem-agnostic: the dept's role specs declare verbs (`generate_module`, `review_diff`, `run_tests`), the adapter registry resolves them to the bound provider — `open-code`, `claude-code`, `codex`, `cursor`, or any later entrant — without rewriting the dept.

Architectural overlay: see [task_plan-departments-and-ecosystems.md](task_plan-departments-and-ecosystems.md). This file is the engineering-dept-specific contents.

Success criteria:
- Operator command: "spin up engineering for `<business>`" → migration, full roster wired in `teams` + `team_members`, agent specs mounted to the per-business container.
- A change request ("add a `/pricing` page") routes from the operator through the dept-lead to the right role agent, returns a PR draft for review.
- Every dispatch goes through the existing [codex-gateway](services/codex-gateway/) for execution work and the [claude-gateway](services/claude-gateway/) for design / review work — the open-code adapter routes through one or both depending on the verb.
- 100% provider-agnostic check (no model pins in spec bodies — the model is decided at adapter level).

Hard constraints:
- No code lands on `main` without a PR, no PR auto-merges. Every dispatch produces a `draft: true` PR via the existing `gh` pattern.
- The dept's `deploy` role is gated by the existing `deploy_to_prod` approval enum — never deploys autonomously.
- Loop semantics inherited from the [bug-hunt-loop pattern](.claude/agents/bug-hunt-loop.md): iteration-plan blocks, operator approval per cycle, no cross-gate progression.
- All write-size discipline from [AGENTS.md](AGENTS.md#write-size-discipline-avoid-opus-stream-timeouts) applies — the builder role's skeleton-then-fill pattern is its primary tactic for any new file > 300 lines.

---

## Phase 1 — Explore

- Read [task_plan-departments-and-ecosystems.md](task_plan-departments-and-ecosystems.md) — adapter contract + ecosystem registry.
- Read [`.claude/agents/codex-operator.md`](.claude/agents/codex-operator.md) and [`.claude/agents/bug-hunt-loop.md`](.claude/agents/bug-hunt-loop.md) — closest existing patterns. The dev-team roles fork these.
- Audit current code-adjacent agents: `nexus-architect`, `nexus-tester`, `workflow-optimizer`. Decide which become dept roles vs which stay platform-level utilities.
- Confirm Open Code's actual API surface, license, model assumptions. (Memory atom worth writing on first contact.)

## Phase 2 — Plan

### Roster — six roles

| Role | Purpose | Verbs the role calls |
|---|---|---|
| `eng-architect` | Brief → ADR-shaped design + atomic-task plan in `task_plan-*.md` shape | `propose_design`, `query_memory`, `read_codebase` |
| `eng-builder` | Atomic task → diff (uses skeleton-then-fill for new files; anchored Edits for refactors) | `generate_module`, `edit_file`, `run_command` |
| `eng-reviewer` | Diff → review comments (forks [Nexus Architect](.claude/agents/nexus-architect.md) + existing /review skill) | `review_diff`, `query_memory` |
| `eng-tester` | Builder output → typecheck + retry-storm + topology + provider-agnostic checks + Playwright spec for UI changes | `run_command`, `read_file` |
| `eng-deployer` | Merged PR → trigger Coolify rebuild / Vercel deploy depending on lean-mode flag | `compose_up`, `deploy_vercel`, `health_check` |
| `eng-oncall` | Production alert → triage → propose hotfix PR draft | `read_logs`, `read_codebase`, `generate_module` |

The dept's **lead** orchestrates: it sees the operator's request, classifies it (`new feature | bug | refactor | incident | maintenance`), and routes to the right starting role. The Ralph-loop invariants apply per cycle.

### Workflow examples

**New feature** ("add `/pricing` page"):
1. Lead receives → classifies as `new feature` → spawns `eng-architect`.
2. Architect proposes an atomic-task plan in an `iteration-plan` block. Operator approves.
3. `eng-builder` executes each atomic task in sequence (skeleton-then-fill for the new file, anchored Edits for `app/layout.tsx` etc.).
4. `eng-tester` runs all four pre-commit checks + adds a Playwright spec under `tests/playwright/`.
5. `eng-reviewer` opens a draft PR with inline review comments.
6. Operator merges → `eng-deployer` triggers deploy.

**Bug** ("logo missing on iPhone Safari"):
1. Lead → `eng-architect` does the 5-whys, proposes a fix sketch.
2. `eng-builder` writes the fix on a branch.
3. `eng-tester` adds the regression spec to the existing `real-device-mobile` Playwright project.
4. PR + deploy as above.

**Incident** ("/api/foo 500 spiking"):
1. Lead → `eng-oncall` reads logs, deep-health, attaches stack trace.
2. Oncall proposes a hotfix branch with a `draft: true` PR plus a kill-switch flag wiring if applicable.
3. Operator approves urgent merge → deployer ships → oncall writes the post-incident atom per [post-incident memory protocol](AGENTS.md#post-incident-memory-protocol).

### New artifacts

- `.claude/agents/departments/engineering/_department.md` — dept spec (purpose, roles, default ecosystem, gates, KPIs).
- `.claude/agents/departments/engineering/{architect,builder,reviewer,tester,deployer,oncall}.md` — six role specs. All ecosystem-agnostic.
- `lib/ecosystems/adapters/open-code.ts` — v1 stub adapter that routes verbs through the existing claude-gateway / codex-gateway. Real Open Code wiring lands when the project goes GA.
- `lib/teams/role-bundles/engineering.ts` — exports the role roster (consumed by the spawn route).

### Default ecosystem set (engineering dept)

| Capability | Default adapter |
|---|---|
| `code` | `open-code` (falls back to `claude-code` if Open Code env unset) |
| `llm` | `claude` (already the platform default) |
| `memory` | `memory-hq` |
| `search` | `tavily` (for "what does the current Next.js docs say about X" queries) |

### Approval gates (added to `approval_gates` enum)

- `merge_to_main` — every PR merge.
- `deploy_to_prod` — already exists; re-used.
- `add_dependency` — any new `package.json` dependency above N changes (`N` set by cost-guard).

Auto (no gate): branch creation, draft PR opening, typecheck runs, Playwright spec writing, memory atom writes after a fix.

## Phase 3 — Implement (v1 deliverables; rest deferred)

v1 ships (covered in the [departments plan v1 scope](task_plan-departments-and-ecosystems.md#part-3--v1-scope-ships-this-pr)):
1. The `open-code` adapter stub.
2. The dept spec at `.claude/agents/departments/engineering/_department.md`.
3. ONE concrete role spec (`engineering/dev-lead.md`) — proves the lead-routing shape end-to-end.
4. Role bundle in `lib/teams/role-bundles/engineering.ts` listing all 6 future roles.

Post-v1:
- Remaining 5 role specs.
- A smoke test (issue → PR) on a fixture business.
- Adapter implementations for `cursor`, `aider`, `codex` so swapping is real, not theoretical.

## Risks

- Open Code's API may change before v1 of the abstraction stabilises. Mitigation: the adapter is a thin shim; on breaking changes we update one file, not every role.
- "Dev team" sounds like it overlaps with `platform-copilot` + `codex-operator`. It doesn't: platform-copilot is the operator's interactive copilot for the PLATFORM itself; the dept is per-business product engineering. They share gateways but the dispatch context (which repo, which branch, which scope) differs.
- Six engineering agents per business × N businesses = a lot of container memory. Mitigation: depts are paused by default; operator activates only when there's real product work.

## Open questions

- Does Open Code support our `.claude/agents/*.md` agent spec format, or does it have its own? Settled in Phase 1 recon.
- Does the dev-lead route via the codex-gateway (execution-heavy) or the claude-gateway (design-heavy)? Likely: classify the work, dispatch to one of the two based on the classification — same pattern as today's claude-vs-codex routing in [ADR 002](docs/adr/002-codex-gateway-sandbox.md).
- Should `eng-deployer` also handle Coolify rebuild for non-Nexus per-business containers? Yes — the dept's scope is the business's product, including its infra.
