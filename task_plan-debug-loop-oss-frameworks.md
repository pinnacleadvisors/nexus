# task_plan — TestSprite / Goose / OSS testing frameworks for the debug loop

> Captured during the Phase 3 wrap-up of [`task_plan-mobile-copilot.md`](task_plan-mobile-copilot.md). The operator wants the codex-debug-loop ([`task_plan-codex-debug-loop.md`](task_plan-codex-debug-loop.md)) to draw on more than just Playwright when proposing fix-attempts — adding AI-aware testing frameworks should give the loop better signal on what's actually broken.

## North Star

**Goal:** Add one OSS framework (or at most two) to the codex-debug-loop's verification toolbox so the agent has a stronger "is this fix right?" signal than Playwright alone provides. Optimize for: cost-bounded, deterministic, replayable, runs in the existing codex-gateway container.

**Success criteria:**
- The codex-debug-loop calls the chosen framework as a stop-decision input (alongside Playwright + `/api/health/deep`).
- The framework adds <30s per loop iteration in the happy path (no regression in iteration cadence).
- The framework's output is structured JSON the loop can parse (not free-text reports).
- No new paid SaaS dependency — the candidate must be self-hostable in the codex-gateway image.

**Hard constraints:**
- Cannot add a framework that requires its own LLM call per test (would double the loop's cost envelope).
- Cannot add one that doesn't sandbox network/filesystem — the loop runs against a real branch checkout and a real dev server.
- Cannot regress the existing Playwright config — new framework runs alongside, not in place of.

## Candidates to evaluate

The operator named **TestSprite** and **Goose**. Both are AI-aware OSS testing frameworks but solve different problems.

| Candidate | Solves | Cost shape | License | Maturity |
|---|---|---|---|---|
| **TestSprite** | Automated test generation from natural-language specs | LLM-per-test (paid) + free CLI | Apache 2.0 (CLI), commercial API for hosted | ~12 mo old |
| **Goose** (Block's open-source AI agent framework) | Multi-step agent that drives tasks via tools — includes testing variants | Bring-your-own-LLM | Apache 2.0 | actively developed |
| **Playwright (already in)** | Browser automation; declarative specs | Free | Apache 2.0 | mature |
| **Stagehand** (Browserbase) | LLM-driven Playwright wrapper for natural-language test steps | LLM-per-step | MIT | early |
| **Magnitude** | AI-native end-to-end test runner | LLM-per-run | MIT | early |
| **Anchor** (Anthropic-backed evals) | Eval framework, not E2E | Self-hosted | TBD | preview |

Initial gut take: **Goose** is the closest fit because it can be wrapped as a codex-delegate target (it's an agent runtime, like codex itself), and **TestSprite** is more of a test-author tool than a fix-loop input — useful for *generating* the Playwright specs the loop uses, less so for the loop itself.

This is initial impression. The evaluation below scores both fairly before committing.

## Evaluation atomic tasks (operator approves before kickoff)

### Task E1 — Sandbox both candidates in a throwaway worktree

- File: `experiments/oss-testing-frameworks/README.md` (new) — captures the eval log.
- Spin up a fresh worktree (`git worktree add ../nexus-oss-test-eval`) and install each framework in its own subdirectory.
- Run each against a known-broken commit in the Nexus codebase (pick one of the 2026-05-04 webhook-self-amplification regressions or the 2026-05-12 Sentry sampler bug — both have well-documented fixes for ground truth).
- Time + cost each run. Record the structured output shape.
- Parallel: yes — independent evals.

### Task E2 — Score against criteria

- File: `experiments/oss-testing-frameworks/SCORECARD.md`
- Rows: setup time, runs/min, $/run, structured output format, network sandboxing, branch/PR awareness, fix-attempt feedback shape.
- Make a recommendation. If neither candidate scores well enough to pull the trigger, the deliverable is "wait and revisit in 6 months" — that's a valid outcome.

### Task E3 — Write the integration PR (if E2 recommends adoption)

- File: `services/codex-gateway/Dockerfile` — add the framework's CLI / runtime.
- File: `.claude/agents/codex-debug-loop.md` (this agent doesn't exist yet — drafted as part of Phase 2 of [`task_plan-codex-debug-loop.md`](task_plan-codex-debug-loop.md)) — extend with the framework as a stop-decision input.
- File: `lib/agents/debug-loop-verification.ts` — helper that parses the framework's JSON output and combines it with Playwright + `/api/health/deep` results.

### Task E4 — Memory + ADR

- ADR `docs/adr/00N-oss-testing-framework-in-debug-loop.md` documenting the choice + the alternatives evaluated.
- memory-hq atom `kind:decision`, `importance:high`, link to `mocs/agent-framework-survey`.

## Decision deferral

Tasks E1-E2 (the eval) can land WITHOUT the codex-debug-loop being built yet — they're independent. E3-E4 depend on the loop existing (Phase 2 of `task_plan-codex-debug-loop.md`).

Recommend doing E1-E2 first, in their own PR, so the decision isn't blocked on the loop infrastructure timeline. If the eval recommends adoption, the framework can sit dormant in the codex-gateway image until the loop ships.

## Risks

- Both candidates are young — adopting either is a bet on continued upstream maintenance. The eval should weight maturity heavily.
- "Add another framework" is the path of least intellectual resistance and often the wrong call. The eval must explicitly consider "do nothing — Playwright is enough" as a tied option. If neither candidate clearly beats Playwright + the existing static checks, ship that conclusion.
- LLM-per-test frameworks (Stagehand, Magnitude) can spiral cost-wise if a flaky spec retries. Cap retries hard in the integration.

## Progress

### Completed
- [x] This plan written.

### Awaiting operator
- [ ] Approve Task E1 (sandbox eval, ~1 day).
