# 008 — Platform-copilot autonomous UI verification before PR

- **Date:** 2026-05-23
- **Status:** Accepted

## Context

The platform-copilot agent (`.claude/agents/platform-copilot.md`) was the operator's interactive copilot for the Nexus codebase: investigate platform state via Composio, propose plans, and on approval edit files + open PRs. The change workflow had seven steps:

1. Investigate (no gate)
2. Propose plan (APPROVAL)
3. Branch + apply changes
4. Verify locally — `tsc --noEmit` + `check:retry-storm`
5. Open PR (APPROVAL — "open the PR?")
6. Preview verification (operator clicks around Vercel preview)
7. Merge (APPROVAL)

Two friction points the operator hit repeatedly:

- **Step 5's approval gate was redundant.** Opening a PR is non-destructive (Vercel previews build on every commit anyway). By the time we hit step 5 the operator had already approved the plan at step 2; another click before PR creation just added a turn without changing risk. The merge gate (step 7) is the actual destructive action.

- **UI changes shipped blind to mobile.** Step 4's `tsc --noEmit` confirms the code compiles, not that the page renders. The operator manages Nexus from a phone while travelling (`task_plan-mobile-copilot.md` Phase 2 mandate), so a PR that "passes tsc" but breaks at 375px is a regression that only surfaces after merge + push to Vercel + manual phone testing. Cost: ~10 minutes per regression × ~3 regressions/week = ~30 min/week of avoidable mobile rework.

The agent could (a) run `npm run dev` locally, (b) drive Playwright at multiple viewports, and (c) embed the screenshot pair inline in chat — IF it had a browser-capable runtime. The claude-gateway image deliberately doesn't bundle Playwright/Chromium (ADR 002 — sandbox isolation, no financial secrets, no browser binaries). The **codex-gateway** image already has Playwright 1.49.1 + Chromium installed for the autonomous-qa loop. The `mcp__codex-delegate__delegate_to_codex` MCP tool was already registered in the claude-gateway entrypoint for execution-heavy work.

So the affordance was: delegate the browser work to codex.

## Decision

Phase 3 of `task_plan-mobile-copilot.md` makes three changes to the agent spec:

1. **Lift the PR-open approval gate.** Step 5 becomes "open DRAFT PR" with `draft: true` mandatory on the call. No operator click before PR creation. The gate moves to step 6→7 ("mark ready" + merge). Net: one fewer approval card per change.

2. **Mandate a UI screenshot pair before step 5 for UI-touching edits.** New step 4b "Verify UI on real dev server" delegates to codex-operator via `delegate_to_codex`. Codex boots `npm run dev` in a fresh checkout of the branch, mints a Clerk sign-in ticket via the existing `/api/admin/issue-bot-session` route (qa-runner pattern, same `BOT_CLERK_USER_ID`), takes screenshots at 1280×800 (desktop) and 375×812 (iPhone 12), uploads to Vercel Blob, returns the URLs. Platform-copilot embeds both inline in chat. Operator sees the result BEFORE step 5 fires.

3. **Mandate Playwright spec subset for in-scope changes.** Step 4c runs `npx playwright test --project=iphone <spec-name>` via codex when an existing spec covers the change scope. Capped to the scope-matched spec — never the full 27-invocation suite without explicit ask.

Alternatives considered:

- **Install Playwright in the claude-gateway image.** Rejected — duplicates the codex-gateway's runtime, doubles image size, and the gateway hosts an unprivileged agent that doesn't need browser binaries. Delegation is the cleaner topology.
- **Run dev server on the operator's laptop and screenshot via Playwright MCP.** Rejected — works for the operator's local interactive sessions but doesn't apply when the agent is invoked from a phone, from a cron, or from a future autonomous loop. The delegation path works regardless of where the operator is.
- **Skip mobile screenshots and rely on Vercel preview.** Rejected — preview deploys take 30-90s and the operator can't reliably check a phone view in chat ("did the button overflow?") without leaving the chat surface. Inline screenshots are the deciding signal.
- **Use the existing qa-runner service instead of codex-delegate.** Considered — qa-runner already has Playwright + the ticket flow. Rejected for the *interactive* loop because qa-runner is webhook-triggered + run-after-deploy by design. For *pre-PR* verification we need synchronous-feeling delegation; codex-delegate's poll API gives us that. qa-runner stays as the production post-deploy smoke layer.

## Consequences

**Becomes easier**:
- Mobile-friendly changes ship with proof. The operator never wonders "does this render on my phone" — the screenshot pair answers in chat.
- One fewer approval card per change (PR-open gate lifted).
- Future autonomous loops (codex-debug-loop, others) can re-use the same delegation idiom without rebuilding screenshot infrastructure.

**Becomes harder**:
- Every UI-touching edit-group now spends one `delegate_to_codex` turn (~30-60s, ~$0.05). Inside `USER_DAILY_USD_LIMIT` envelope but real cost. Mitigated by gating the screenshot pass on UI-surface file globs (no screenshot for a pure backend change).
- The claude-gateway image now depends on the codex-gateway being healthy AND having a valid `BOT_CLERK_USER_ID` env. When codex is down, the spec instructs the agent to fall back to "open the PR without screenshots, mark in the description that mobile verification is missing." Documented in step 4b.
- `draft: true` mandate means the operator must explicitly click "Ready for review" before merge automation hooks fire. Some operators prefer the old "non-draft from start" flow; this adds a step. Trade-off accepted because branch-protection rules on this repo treat draft + non-draft identically for merge eligibility.

**Must be revisited**:
- If the operator stops using a phone for management (e.g. travels less, prefers laptop), the cost of the mandatory screenshot pass may exceed its benefit. Re-evaluate at the next quarterly review of `task_plan-mobile-copilot.md`.
- If Vercel Blob is ever swapped for another asset store (e.g. R2, S3), update the delegation template in the agent spec.
- If `BOT_CLERK_USER_ID` becomes a per-business-scoped pattern (e.g. one bot per business), the centralised ticket endpoint at `/api/admin/issue-bot-session` will need a scope param. Out of scope today.

## Related

- [`task_plan-mobile-copilot.md`](../../task_plan-mobile-copilot.md) — long-horizon plan housing Phases 1/2/3.
- [`.claude/agents/platform-copilot.md`](../../.claude/agents/platform-copilot.md) §4-7 — the change workflow with this ADR's changes applied.
- [`services/qa-runner/README.md`](../../services/qa-runner/README.md) §"Manual setup checklist" — the bot Clerk user / `BOT_CLERK_USER_ID` setup the new flow reuses.
- [`app/api/admin/issue-bot-session/route.ts`](../../app/api/admin/issue-bot-session/route.ts) — the ticket-minting endpoint the codex delegation calls.
- ADR 002 — codex-gateway vs claude-gateway sandbox topology that this decision builds on.
