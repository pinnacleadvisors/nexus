# Task-plan triage — 2026-05-26

**Source**: parallel scan of every `task_plan-*.md` in tree (36 files).
**Goal**: identify which plans are still active and which should be shipped in this session's Phase C.
**Generator**: claude session under `claude/openrouter-provider-2026-05-26` (in-session-only; not committed yet).

Priority follows the North Star ("autonomously build + manage a real business that makes profit"):
- **1**: blocks profit goal (must ship to make autonomous business creation real)
- **2**: improves profit goal (nice-to-have for autonomy)
- **3**: unrelated polish / infrastructure

| Plan | Status | Outstanding (1-line) | Priority |
|---|---|---|---|
| `task_plan-bug-hunt-loop.md` | active | All phases B0–B8 planned but blocking on B0/B0.5 prereqs; no code yet | 1 |
| `task_plan-claude-headless-cost-recovery.md` | active | Task G1 cost-measurement spike gates G2–G5; no work started | 1 |
| `task_plan-codex-debug-loop.md` | active | Phase 1 verification primitives planned, gated on operator approval | 1 |
| `task_plan-content-team-higgsfield.md` | active | 6-agent roster + Higgsfield endpoint resolver; no Progress block — unknown state | 1 |
| `task_plan-departments-and-ecosystems.md` | active | v1 spine partly shipped; remaining roles, custom org-chart UI deferred | 1 |
| `task_plan-design-team-open-design.md` | active | 7-agent design roster planned; no Progress block — unknown state | 1 |
| `task_plan-dev-team-open-code.md` | active | v1 deliverables planned; no Progress block — unknown state | 1 |
| `task_plan-execution-overhaul.md` | partial | Phase 7 shipped; pilot rollout + memory-hq push + GHCR image push remain | 1 |
| `task_plan-platform-improvements.md` | active | Onboarding/stale-cards/webhook-verify tracks; needs owner answers + impl | 1 |
| `task_plan-solopreneur-experiment.md` | partial | Groups A–D shipped; Groups E (smoke tests) + F (launch + day 1/7/14/30) remain | 1 |
| `task_plan-thai-sales-agency.md` | active | 10-slice plan; Progress block empty — implementation not started | 1 |
| `task_plan-user-tester-panel.md` | abandoned | DEFERRED — design parked; no code work started | 1 |
| `task_plan-autonomous-qa.md` | partial | Code shipped (Q1–Q15); 8 operator env-setup steps + CLAUDE_MAX_ONLY flip remain | 2 |
| `task_plan-chat.md` | partial | Phases 1–5b/8/2c shipped; Phase 7 (Playwright smoke) in-flight | 2 |
| `task_plan-claude-gateway.md` | shipped | All G1–G13 done; gateway live and serving production traffic | 2 |
| `task_plan-collaborative-chat.md` | active | Phase 0 mobile shipped; Phases 1–6 (mode/model/manual/bg/swarm) awaiting approval | 2 |
| `task_plan-debug-loop-oss-frameworks.md` | active | Plan rewritten; Streams T/B/R/D awaiting operator approval | 2 |
| `task_plan-gbrain-integration.md` | active | Phase 1 recon + benchmark gated; no Progress block — unknown state | 2 |
| `task_plan-harness-absorption.md` | partial | Phase 1 + tracker shipped; Groups A–E awaiting operator approval (esp. Group D) | 2 |
| `task_plan-hmem-architecture.md` | active | 2 new tables + memory_walk MCP + benchmark planned; no Progress block | 2 |
| `task_plan-lean-mode.md` | partial | Tasks 1–20 done; lint/memory-hq push/Mimo+Ollama activation + manual cutover left | 2 |
| `task_plan-learning-system.md` | active | All tasks T1a–T5e pending; implementation about to start | 2 |
| `task_plan-model-agnostic-chat.md` | partial | M0 (Codex toggle stub) in flight; M1–M10 await design approval | 2 |
| `task_plan-model-agnostic-platform.md` | partial | MA1 (overlay resolver) in same PR as plan; MA2–MA7 await approval | 2 |
| `task_plan-paperclip-absorption.md` | partial | Phase 1 audit/ADR shipped; Phase 2–4 (migrations + UI + features) remain | 2 |
| `task_plan-paperclip-ui-phase-2.md` | partial | PR-273 sidebar/inbox shipped; Tasks A–G (create_business, Ctrl+K, agent pages) open | 2 |
| `task_plan-platform-expansion.md` | partial | Tasks A–F shipped 2026-05-25; 4 operator follow-ups (migrations, NEXUS_AUDIT_TOKEN, pg_exec, audit-wire) | 2 |
| `task_plan-redesign-ai-providers.md` | shipped | All Tasks 1–17 done; typecheck + retry-storm + build green | 2 |
| `task_plan-workforce-intelligence.md` | active | Tasks 1–6 planned (Hindsight retrieval, capability scoring, etc.); no work started | 2 |
| `task_plan-chat-views.md` | partial | V1 (Esc+Notes) up next; V2 Accounts / V3 Live / V4 Memory planned | 3 |
| `task_plan-connector-intent.md` | active | Phase 1+2 done; Phase 3 atomic tasks 1–7 (migration+API+UI) remain | 3 |
| `task_plan-hermes-agent.md` | abandoned | CLOSED 2026-05-23 — operator picked option (C) "already absorbed" | 3 |
| `task_plan-memory-architecture.md` | partial | Steps 1–7 shipped; Step 8 (branch-per-agent + GitHub App) deferred + 5 owner actions | 3 |
| `task_plan-mobile-copilot.md` | partial | Phase 0/scaffolding done; Phases 1–3 (timeout, mobile fixes, copilot autonomy) await approval | 3 |
| `task_plan-sse-streaming.md` | active | Tasks 2–9 (stream-events lib + SSE route + UI wiring) all open; Progress empty | 3 |
| `task_plan-this-week.md` | active | Blocks A–D (PR #308 merge, Esc+Notes, stale-cards, Slack verify) awaiting approval | 3 |

## Phase C selection — what to ship this session

Most Priority-1 plans either:
1. **Need operator approval before kickoff** (debug-loops, harness-absorption Group D, model-agnostic-chat M1+)
2. **Are research/spike work** (cost-recovery G1)
3. **Are giant 10-slice greenfield plans** (thai-sales-agency, content-team-higgsfield)

Two are concrete and shippable without operator gating:

- **`task_plan-solopreneur-experiment.md` Group E (smoke tests)** — concrete unit + e2e impl work for the agent that IS Nexus's flagship "make money autonomously" demonstration. Direct line to North Star.
- **`task_plan-platform-improvements.md`** — onboarding / stale-cards / webhook-verify. UX-layer; some sub-tasks are blocking operator answers but the stale-cards track is mechanical.

Phase C will read those two and pick the most narrowly bounded sub-track. Defer the rest to subsequent sessions OR file as `issues/` rows for the operator.
