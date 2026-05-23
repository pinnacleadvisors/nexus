# task_plan — Layered AI-native testing framework for Nexus (code + business ops)

> Captured during the Phase 3 wrap-up of [`task_plan-mobile-copilot.md`](task_plan-mobile-copilot.md), expanded 2026-05-23 in response to the operator's question:
>
> _"Is there a way to combine the best components of each candidate to existing Playwright to create a superior testing framework for nexus? How do we apply this framework to business operations?"_
>
> Yes. The candidates each solve a *different layer* of the testing problem, and stacking them on top of Playwright gives Nexus capabilities that no single framework provides. The same stack applies, almost unchanged, to verifying **business operations** (customer journeys, payment flows, email campaigns) — a second application surface that's currently un-tested except by humans noticing breakage.

## North Star

**Goal:** Build a layered, AI-native testing framework on top of the existing Playwright base that (a) shortens the codex-debug-loop's "is this fix right?" feedback cycle, (b) generates regression specs automatically from English bug descriptions, and (c) extends the same primitives to verify per-business operations — Stripe checkouts, ConvertKit campaigns, Slack support flows, Shopify orders. One framework, two application surfaces (code + business ops).

**Success criteria:**

- **Code-side**:
  - Codex-debug-loop calls the layered framework as its primary stop-decision input (alongside `/api/health/deep`).
  - Ad-hoc verifications during a loop iteration take <30s in the happy path.
  - A new test spec can be generated from an English bug report in <60s and lands in `tests/playwright/` as a permanent regression test.
- **Business-ops-side**:
  - A `business-ops-tester` agent runs end-to-end checks on a per-business schedule (e.g. daily smoke). Failures land in the operator's Inbox (`/inbox`) and trigger a fix-attempt loop.
  - Each business gets a "business smoke pack" — a set of named invariants (`can_complete_checkout`, `welcome_email_fires`, `slack_channel_active`) that's expressed in English and compiles down to Playwright + Composio API calls.
- **No new paid SaaS dependency**: every layer is self-hostable in the existing claude-gateway / codex-gateway / qa-runner / per-business container topology.

**Hard constraints:**

- Cannot replace Playwright. The deterministic execution layer stays as the ground truth — every artifact must be a Playwright spec a human can read.
- Cannot regress the existing single-flag-cost envelope (`USER_DAILY_USD_LIMIT`). The framework adds LLM calls; budgeted per layer below.
- Cannot create cross-business test pollution. Business-ops tests for business A must not touch business B's Stripe metadata, Composio tokens, or Cloudflare DNS — same `business_slug` partition rule as everything else (per [AGENTS.md](AGENTS.md) topology).
- Cannot make business-ops tests so expensive that running the smoke pack daily across N businesses bankrupts the kill-switch. ~$1/business/day target.

## The synthesis stack

Each candidate framework solves a different layer. They compose rather than compete:

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │  LAYER 5 — Evaluation                                                  │
 │  Anchor-style eval framework (or homegrown).                           │
 │  Tracks: did the fix make the failing test pass? Did it introduce new  │
 │  failures? Did the operator approve the merge? Did the business smoke  │
 │  pack stay green across the fix?                                       │
 │  Per-run cost: $0 (operates on durable test artefacts, not LLM calls). │
 ├────────────────────────────────────────────────────────────────────────┤
 │  LAYER 4 — Agent orchestration                                         │
 │  codex-debug-loop + business-ops-tester. Owns the "what do I try next" │
 │  decision — propose fix → run layer 2-3 → grade via layer 5 → repeat   │
 │  until green or cost cap. Goose teaches us the pattern (tool registry, │
 │  bounded planning, structured eval gates); we already implement most   │
 │  of it via Claude Code agents. No need to import Goose itself.         │
 │  Per-run cost: $0.05-0.50 (loop iteration count × LLM turn).           │
 ├────────────────────────────────────────────────────────────────────────┤
 │  LAYER 3 — Spec generation                                             │
 │  TestSprite-style: English bug report → Playwright spec. One-time      │
 │  LLM cost per spec; output is reusable forever (lives in tests/        │
 │  playwright/ or services/qa-runner/e2e/). Critically: this is what     │
 │  takes "a customer reported X" from "open a ticket" to "land a         │
 │  regression test in 60s" — and from there into the layer-4 loop.       │
 │  Per-spec cost: ~$0.10-0.50 amortised across all future runs.          │
 ├────────────────────────────────────────────────────────────────────────┤
 │  LAYER 2 — Ad-hoc natural-language verification                        │
 │  Stagehand or Magnitude. LLM-driven Playwright wrapper. The loop's     │
 │  "navigate to dashboard, click Settings, screenshot what you see"      │
 │  doesn't need a pre-written spec; it's a one-shot probe. The agent     │
 │  issues English instructions, the wrapper translates to Playwright     │
 │  actions, the assertion is "did the agent observe the expected         │
 │  invariant?" Output is structured JSON.                                │
 │  Per-call cost: ~$0.05 (LLM + Playwright run).                         │
 ├────────────────────────────────────────────────────────────────────────┤
 │  LAYER 1 — Deterministic execution (already shipped)                   │
 │  Playwright. tests/playwright/ + services/qa-runner/e2e/ with the new  │
 │  chromium / iphone / android projects from Phase 2. Specs are TypeScript│
 │  any developer can read + replay locally. No LLM in the hot path.      │
 │  Per-run cost: $0 (browser binaries only).                             │
 └────────────────────────────────────────────────────────────────────────┘
```

**Why layered beats pick-one:**

- TestSprite alone leaves the loop without a fast "is this fix right?" probe — every assertion is an LLM call.
- Stagehand/Magnitude alone leaves no durable artefacts — every probe is throwaway.
- Goose alone reinvents what the Claude Code agent framework already does in `.claude/agents/*`.
- Playwright alone gives no help when the bug isn't yet captured as a spec.

The layers also have an inversion-of-control story: when a new bug surfaces, **Layer 3 promotes it to a Layer 1 artefact** (a durable spec). Layer 2 is the scratch surface that turns into Layer 1 specs over time. The framework gets cheaper over time as more probes are promoted.

**Cost envelope (worked example):**

- Codex-debug-loop runs daily, ~5 iterations per active branch, ~3 active branches/day = ~15 iterations × $0.05 (Layer 2 probe) = $0.75/day on Layer 2.
- New regression specs: ~2/week × $0.20 (Layer 3) = ~$1.60/month.
- Layer 4 orchestration: subscription-billed (Claude Max + Codex Pro), no marginal cost.
- Layer 5 evaluation: $0.
- **Total code-side cost: <$1/day on the marginal Layer 2/3 calls.**

For business-ops (covered below), multiply by N businesses but with mostly idempotent re-runs.

## Application surface 1 — Code (the codex-debug-loop)

The codex-debug-loop (planned in [`task_plan-codex-debug-loop.md`](task_plan-codex-debug-loop.md)) gets these primitives:

| Primitive | Layer | When invoked |
|---|---|---|
| `runPlaywrightSpec(path, project)` | 1 | Stop-decision input every iteration |
| `verifyEnglish("Does the dashboard render at 375px without horizontal scroll?")` | 2 | Mid-iteration probes; cheaper than writing a spec |
| `generateSpec(bugDescription, scopeFile)` → `tests/playwright/<slug>.spec.ts` | 3 | When a new bug class is identified; landed as a permanent test |
| `dispatchFixAttempt(diagnosis, scopeFile)` | 4 | The loop's own orchestration (already partly in `.claude/agents/`) |
| `gradeFixCohort(branchSha, beforeSpecResults, afterSpecResults)` | 5 | After each fix-attempt; output feeds next-iteration prompt |

The codex-debug-loop spec (when shipped per Phase 2 of its own task_plan) gets a new section: "Verification primitives" listing the five above as the only sanctioned ways to read state. The loop's stop-decision is the AND of: `runPlaywrightSpec` (all green) AND `verifyEnglish("does the user-reported behaviour now match expectations")` (LLM confirms) AND `gradeFixCohort` (no new failures introduced).

## Application surface 2 — Business operations (the new and bigger one)

A "business" in Nexus has operations that are currently verified only by humans noticing when they break:

- **Storefront / Checkout** — can a new customer complete a Stripe checkout from a Shopify product page in <5 minutes without errors?
- **Email campaigns** — does the welcome-email Composio action actually fire on signup? Does the open-rate match the baseline?
- **Customer support** — is the Slack `#support` channel responsive (no >24h unanswered messages)? Does the daily summary cron actually run?
- **Content publishing** — does the scheduled blog post actually appear on the public site? Did the social post fire?
- **Inventory / SLA** — is the per-business KVM4 Coolify container responsive on `/health`? Did the latest cron tick land in `experiment_metrics`?

**The same layered stack applies, with one substitution at Layer 1:**

| Code-side | Business-ops side |
|---|---|
| Layer 1: Playwright on `tests/playwright/` | Layer 1: Playwright **plus** Composio MCP calls. The "test" might drive a real customer journey (Playwright) and then query Stripe/Gmail/Slack/Shopify (Composio) to verify the downstream effect. |
| Layer 2: Stagehand probe of `localhost:3000` | Layer 2: Stagehand probe of the live business storefront URL + Composio "did the email arrive?" probes |
| Layer 3: Spec generation from a code bug report | Layer 3: Spec generation from a **customer support ticket** — "customer says checkout failed at step 3" → a Playwright + Composio spec lands in `tests/business-ops/<slug>/checkout.spec.ts` |
| Layer 4: codex-debug-loop on a branch | Layer 4: **business-ops-tester** agent on a per-business cron — runs the smoke pack, surfaces failures to the operator's Inbox, can dispatch fix-attempts via business-operator (already exists) for autonomous remediation |
| Layer 5: Did the fix make the failing test pass? | Layer 5: Did the fix make the failing **invariant** pass? Same logic, different artefacts. |

**Concrete business-ops smoke pack example** (for an example business `inkbound`):

```yaml
# memory/business-ops/inkbound/smoke-pack.yaml (new file convention)
smoke:
  - id: storefront_renders
    layer1: tests/business-ops/inkbound/storefront.spec.ts
    expected_runtime_s: 15

  - id: checkout_completes
    layer1: tests/business-ops/inkbound/checkout.spec.ts
    composio_assert:
      platform: stripe
      action: STRIPE_LIST_ALL_PAYMENT_INTENTS
      args: { metadata: { business_slug: inkbound, test_run: '{{ run_id }}' } }
      assertion: at_least_one_succeeded
    expected_runtime_s: 60
    requires_test_card: true

  - id: welcome_email_fires
    layer1: tests/business-ops/inkbound/signup.spec.ts
    composio_assert:
      platform: gmail
      action: GMAIL_LIST_MESSAGES
      args: { q: 'to:{{ test_email }} subject:welcome', maxResults: 1 }
      assertion: at_least_one_match
    expected_runtime_s: 90

  - id: support_channel_active
    layer2_probe: "Open the inkbound Slack workspace. Check #support. Are there any messages older than 24h with no reply?"
    expected_runtime_s: 30
    severity: warning  # not a hard fail — just an alert
```

The `business-ops-tester` agent reads this file, runs each row, posts results to `experiment_metrics` (failure surfaces in `/inbox` per the Phase 2 absorption work), and on hard fail dispatches a fix-attempt to `business-operator` (the existing autonomous orchestrator) for that business.

**Container topology:**

- The smoke pack runs on the existing qa-runner container (it already has Playwright + Composio access via the bot's session ticket).
- Test cards (Stripe `4242 4242 4242 4242`) and test emails (`test+<run-id>@<your-domain>`) are scoped per run so flake doesn't cross-contaminate production data.
- Per-business smoke runs are tagged `business_slug=<slug>` so kill-switches scope properly.

**Cost envelope (worked example for business-ops):**

- 5 active businesses × 1 daily smoke × 4 invariants × $0.05 (Layer 1 + Layer 2 average) = ~$1/day.
- Layer 3 spec generation when a customer ticket lands: ~5/month × $0.20 = ~$1/month.
- Layer 4 fix-attempts: bounded by existing `USER_DAILY_USD_LIMIT` envelope.
- **Total business-ops cost: ~$1/day across 5 businesses.** Inside the operator's existing cost-guard rails.

## Atomic tasks (operator approves each before kickoff)

Four streams, parallelisable where marked.

### Stream T — Layer-by-layer integration

#### Task T1 — Stagehand spike (Layer 2, code-side first)

- File: `experiments/stagehand-spike/README.md` (new)
- Spin up Stagehand in a throwaway worktree; wire it against `localhost:3000`.
- Test: "Can I drive the platform-copilot chat composer with natural-language instructions and assert the timeout selector responds?"
- Output: cost-per-probe, structured-output shape, reliability across 10 runs.
- Decision: ship → Task T2, or fall through to Magnitude (Task T1b).
- Parallel: yes.

#### Task T1b — Magnitude spike (parallel alternative to T1)

- Same shape; different framework. If T1 fails the reliability bar, T1b is the fallback.
- Parallel: yes.

#### Task T2 — TestSprite-style spec generator (Layer 3)

- File: `lib/testing/spec-generator.ts` (new) — a thin LLM wrapper that takes `{ bugDescription, scopeFile, screenshotUrls? }` and emits a Playwright spec compatible with the existing `tests/playwright/` shape.
- Spike against 3 known-fixed bugs (from `memory/molecular/atoms/`) — does the generator emit a spec that catches the original regression?
- Decision: ship as-is, or wrap an existing OSS spec generator if one matures by review time.
- Parallel: depends on T1 (uses the same LLM wrapper conventions).

#### Task T3 — Evaluation/grading framework (Layer 5)

- File: `lib/testing/grade.ts` — homegrown, since Anchor's OSS maturity is uncertain.
- Track per-fix-attempt: spec results before/after, did the operator merge, did new failures surface within 24h.
- Output: rolling 30-day pass-rate per agent (codex-debug-loop, business-ops-tester).
- Parallel: yes — no dependencies.

#### Task T4 — Wire into codex-debug-loop (Layer 4 hook)

- Depends on the codex-debug-loop existing — see Phase 2 of [`task_plan-codex-debug-loop.md`](task_plan-codex-debug-loop.md).
- After that loop is shipped, add the five verification primitives from §"Application surface 1" as its stop-decision inputs.
- Parallel: no — explicitly blocked on the upstream plan.

### Stream B — Business-ops application

#### Task B1 — Define the smoke-pack file format

- File: `docs/runbooks/business-ops-smoke-packs.md` (new)
- Codify the YAML shape from §"Application surface 2" (`memory/business-ops/<slug>/smoke-pack.yaml`).
- Document the "Layer 1 + Composio assert" convention so the operator can author packs by hand if needed.
- Parallel: yes — pure docs.

#### Task B2 — `business-ops-tester` agent spec

- File: `.claude/agents/business-ops-tester.md` (new)
- Defines: read `smoke-pack.yaml` for a business → run each row → post results to `experiment_metrics` → on fail, generate Layer 3 spec from the failure context and dispatch via `business-operator`.
- Approval gates: same Ralph-loop invariants (operator-gated kickoff, bounded iterations, draft PRs only when proposing code fixes).
- Parallel: yes after T2 (uses spec-generator).

#### Task B3 — First business smoke pack — pick the highest-value business

- File: `memory/business-ops/<chosen-slug>/smoke-pack.yaml`
- Operator picks the business (e.g. the active PDF-info-product slot).
- 3-5 invariants to start. Run by hand against the live business; iterate until the pack is stable.
- Parallel: depends on B1 + B2.

#### Task B4 — Per-business cron wiring

- File: `app/api/cron/business-ops-smoke/route.ts` (new)
- Reads `business_operators` table, finds all rows with `experiment_flag=true`, runs each one's smoke pack on a configurable cadence (default daily).
- Surfaces failures to `/inbox` via the existing approvals + assigned-issues plumbing.
- Parallel: depends on B3 (need at least one working pack to dispatch against).

#### Task B5 — Memory + ADR

- ADR `docs/adr/00N-layered-ai-native-testing.md` — captures the synthesis decision + the cost envelope.
- memory-hq atom: `kind:decision`, `importance:high`, links to `mocs/agent-framework-survey` and a new `mocs/testing-framework`.
- Parallel: yes — write after T1-T2-B1-B2 land.

### Stream R — Risk + cost guard

#### Task R1 — Cost-guard integration

- Every layer call routes through `checkKillSwitch(businessSlug)`. Tested with synthetic high-volume traffic on a non-prod business slug.
- Parallel: yes.

#### Task R2 — Per-business token scoping (business-ops-only)

- The smoke pack uses Composio actions against the business's connected accounts. Verify via the existing `business_slug` partition that a business-A pack can't read business-B's Stripe.
- Parallel: yes — pure audit + test.

### Stream D — Decision deferral

#### Task D1 — Sandbox eval still required

The synthesis vision above doesn't eliminate the need to actually run Stagehand / Magnitude / TestSprite in anger. The T1/T1b spikes are the empirical check. If both fail the reliability bar AND the cost bar, the framework gracefully falls back to "Playwright + homegrown LLM wrapper at Layer 2-3" — no external framework adopted. That's a valid outcome and the existing Phase 1+2 Playwright coverage is unaffected.

## Risks

- **Layer 2 reliability**. LLM-driven browser automation is famously flaky on the second decimal of intent ("click the Save button" works; "click the button that confirms changes" sometimes clicks a Cancel button labelled similarly). Spike must measure 10-run reliability, not 1-run feasibility.
- **Layer 3 spec drift**. Auto-generated specs can lock in *current* behaviour as correct even when the current behaviour is itself wrong. Mitigation: every generated spec lands as a *draft* PR (per the Phase 3 mandate) so the operator reviews each one before it joins the durable suite.
- **Business-ops false positives**. A flaky Composio API (Slack 5xx, Stripe rate-limited) reads as a failed invariant. Mitigation: retry-with-backoff at the Layer 2 wrapper; only fail the invariant after 3 retries spaced across 5 minutes.
- **Cross-business pollution.** Already covered by the existing `business_slug` partition pattern; B-Task R2 verifies.
- **Cost runaway in business-ops**. 5 businesses × 24h × $5 budget = pathological case if invariants enter an LLM-call retry loop. `checkKillSwitch` per-call + per-business + per-day caps mitigate. R1 verifies.
- **"Just use Playwright + homegrown LLM wrapper"** might score nearly as well as Stagehand. The eval must explicitly weight "do nothing extra" as a valid outcome — if the spike doesn't show clear wins, ship the conclusion as a closed-plan and stay on the existing Phase 1+2 base.

## Progress

### Completed

- [x] Plan rewritten 2026-05-23 from "pick one framework" to "layered synthesis + business-ops application" (this doc).
- [x] Hermes plan closed (Option C) — see [`task_plan-hermes-agent.md`](task_plan-hermes-agent.md).

### Awaiting operator approval

- [ ] Stream T — Layer-by-layer integration (T1 spike first, ~2 days)
- [ ] Stream B — Business-ops application (after T1-T2 land, ~3-5 days)
- [ ] Stream R — Cost guard + scoping (~1 day, parallel)
- [ ] Stream D — Eval-then-decide checkpoint (built into T1)

### Open questions

- Which business is the right pilot for B3? (Highest-revenue / most-active gets the smoke pack first.)
- Does the operator want the business-ops smoke pack to live in `memory/business-ops/<slug>/` (per-repo, version-controlled) or in Supabase (per-business, dynamic)? Trade-off: repo = reviewable in PRs; DB = changeable without a deploy. Default in this plan = repo, can flip.
- Does the per-business smoke pack run inside the per-business Coolify container OR centrally from qa-runner? Default = qa-runner (simpler topology), but the per-business container has its own MCP set scoped to that business.
