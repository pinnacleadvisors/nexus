# task_plan-user-tester-panel.md

Goal: Ship a `user-tester-panel` managed agent that runs synthetic-persona feedback on a business's assets and posts findings into the existing `workflow_feedback` table — so the `workflow-optimizer` agent can chew them like any other feedback row.

Success criteria:
- Single agent spec at `.claude/agents/user-tester-panel.md` invokable from any chat surface or autonomously from `solopreneur-loop`.
- Panel findings post to `workflow_feedback` using the existing `{ summary, details, source }` shape (already supported by `app/api/workflow-feedback/route.ts`) — no new table.
- Operator-gated `panel-review` block renders inline in chat; on approve, findings persist server-side and `workflow-optimizer` picks them up.
- Cost-gated via `checkKillSwitch(businessSlug)` + daily-USD cap.
- Each panel emits an honest `verdict.confidence: 'high' | 'medium' | 'low'`, where `'high'` requires real-review priors found via `memory_search`.
- Per-business spend cap (`USER_DAILY_USD_LIMIT`) enforced before persona generation begins, not after.

Hard constraints:
- Synthetic personas are NOT pay-intent validation. The spec + confidence field must reflect that — don't oversell to the operator OR to downstream agents.
- Don't fork the feedback table. Reuse `workflow_feedback`.
- The panel never auto-edits assets. Synthesis flows through `workflow-optimizer`, which has its own approval gate.
- Personas must be seeded with distinct skepticism levels (at minimum one `high`, one `ready-to-buy`) to defeat convergent hallucination. This is a spec requirement, not an aspiration.
- No production mutations from inside the loop (per AGENTS.md "Operator-gated loop pattern" invariants).

## Status

**DEFERRED — design parked here.** AGENTS.md formalised the Ralph loop pattern in the same PR that created this file. This plan exists so a future builder can pick the work up cold without re-deriving the design. No code work has started.

## Phase 1 — Explore (done; findings captured)

- **Existing loop exemplars** (`bug-hunt-loop`, `workflow-optimizer`, `edit-plan` block in copilots) define the operator-gated pattern this agent will use. See AGENTS.md `### Operator-gated loop pattern ("Ralph loop")`.
- **Feedback route already accepts non-human shape**: `app/api/workflow-feedback/route.ts` line 92 accepts `{ summary, details, source }` in addition to the human `{ feedback }` shape. Originally scaffolded for a `qa-runner` that was never built — the user-tester-panel inherits the slot.
- **workflow-optimizer ingestion path**: `.claude/agents/workflow-optimizer.md` reads `open` rows from `workflow_feedback`, proposes minimal diffs, logs to `workflow_changelog`. Picks up panel findings for free.
- **No persona/user-tester scaffolding exists**: `rg "persona|user-tester|jtbd|usability"` over `app/`, `lib/`, `.claude/agents/`, `docs/` → 0 hits as of 2026-05-16. Greenfield.
- **`solopreneur-loop`** is the natural auto-trigger consumer — it produces 3–7 assets per cycle and has no automated quality signal between "produced" and "operator sees it on the Board".
- **Block renderer infrastructure** already supports new block types (see `approval-request`, `manual-task`, `edit-plan`, `iteration-plan`, `bug-hunt-finding` in chat poll route + block-registry).

## Phase 2 — Plan (atomic tasks)

### Task 1 — Persona generation primitive
- File: `lib/user-tester/personas.ts` (new)
- Change: Export `generatePersonas({ businessSlug, n }): Promise<Persona[]>`. Each persona has `{ id, name, jtbd, skepticism: 'high' | 'medium' | 'low' | 'ready-to-buy', constraints[], one_line_bio }`. Source order: `memory_search` for `mocs/<slug>-personas` atoms → fallback to LLM-generated diverse panel keyed by `niche` + `money_model` from the business row. Returns a `priors_source: 'real-reviews' | 'llm-generated'` field for confidence calibration.
- Verify: `n=5` returns 5 distinct personas with at least one `skepticism: 'high'` and at least one `skepticism: 'ready-to-buy'`. Unit test stubs `memory_search`.
- Parallel: no (foundational)

### Task 2 — Per-persona evaluation primitive
- File: `lib/user-tester/evaluate.ts` (new)
- Change: Export `evaluateAsset({ persona, artifactUrl?, artifactBody?, lens }): Promise<PersonaVerdict>`. Returns `{ persona_id, jtbd_match: 1-5, friction[], confusing[], cut[], improve[], verdict: string }`. One LLM call per persona; parallelisable across personas via `Promise.all`. Lens vocabulary: `usability | conversion | value-prop | trust | friction`.
- Verify: 5 personas × 1 asset = 5 verdicts returned in parallel. Each verdict references the persona's `jtbd` in its `verdict` string.
- Parallel: yes (can start in parallel with Task 1 — they depend on the same `Persona` type but build independently)

### Task 3 — Synthesis aggregator
- File: `lib/user-tester/synthesise.ts` (new)
- Change: Export `synthesise(verdicts: PersonaVerdict[], priors_source): PanelSynthesis`. Returns `{ convergent_themes[], sharpest_dissent[], cut_consensus[], improve_consensus[], confidence }`. Confidence rule: `'high'` only when `priors_source === 'real-reviews'` AND ≥ 3 personas converge on top theme; `'medium'` when LLM-generated personas converge ≥ 60%; `'low'` otherwise.
- Verify: 5 verdicts with 3-overlapping `friction` items → that item appears in `convergent_themes`. No overlap → all items move to `sharpest_dissent`. Synthetic priors + 4/5 consensus → `confidence: 'medium'`.
- Parallel: no (depends on Task 2 output)

### Task 4 — Agent spec
- File: `.claude/agents/user-tester-panel.md` (new)
- Change: Standard managed-agent spec. Tools: `Read, Bash, WebFetch` (for fetching artifactUrl), plus MCP `mcp__memory-hq__memory_search` for persona priors. Emits the `panel-review` block format (sibling to `iteration-plan` / `approval-request`). Documents the cost-gate (call `checkKillSwitch` before persona generation), the persona-diversity rule, the confidence-honesty rule, and the "synthetic ≠ pay-intent validation" caveat. Follows AGENTS.md operator-gated loop pattern invariants verbatim.
- Verify: Spec parses by the agent-generator regex; lists ≥ 2 plausible tools per AGENTS.md tool-budget rule; has clear North Star, NOT, and example `panel-review` block sections.
- Parallel: yes (can drafted alongside Tasks 1–3)

### Task 5 — Chat block renderer + handler
- File: `components/chat/blocks/PanelReviewBlock.tsx` (new) + register in `lib/chat/block-registry.ts` + handler in chat poll route
- Change: Renders the `panel-review` JSON as an inline card showing synthesis + per-persona signature line + Approve/Reject buttons (matches FloatingActionBar pattern). On Approve: POSTs N rows to `/api/workflow-feedback` with `source: 'user-tester-panel:<persona-id>'` — one row per convergent theme so `workflow-optimizer` can chew each one individually. Reject persists the panel as `manual-task` for operator notes.
- Verify: Renders against a fixture JSON; Approve button posts N rows and shows "filed N feedback rows" toast. Approve disabled when `confidence: 'low'` AND `convergent_themes.length === 0`.
- Parallel: no (depends on agent emitting the block — Task 4)

### Task 6 — Cost gate + audit
- File: extend `lib/cost-guard.ts`
- Change: `checkPanelCostGate(businessSlug, personaCount)` — checks kill-switch + estimates panel cost (`personaCount * ~$0.03` for sonnet, scaled by lens length) against `USER_DAILY_USD_LIMIT`. Logs each panel run to `experiment_metrics` with `kind: 'panel_review_run'` + `payload: { personaCount, lens, confidence, themes_count }`.
- Verify: Mock the daily cap at $0 → `checkPanelCostGate` returns `{ ok: false, reason: 'daily-cap' }`. Successful run produces one `experiment_metrics` row.
- Parallel: yes (with Tasks 1–3)

### Task 7 — solopreneur-loop integration (deferred to a separate PR after Tasks 1–6 ship)
- File: `.claude/agents/solopreneur-loop.md`
- Change: Add a routing rule — after producing an asset (`storefront`, `landing_page`, `ad_creative`, `lead_magnet_pdf`), dispatch a `user-tester-panel` run with `persona_count: 3, lens: 'value-prop'`. If `verdict.confidence === 'low'` AND `cut_consensus.length >= 2`, route the asset through `workflow-optimizer` before publishing.
- Verify: Manual smoke — produce a fake asset, watch the loop fire a panel, observe synthesis influencing the next cycle. Track `panel_review_run` rows in `experiment_metrics` against asset-publish rate.
- Parallel: yes — but deferred until Tasks 1–6 prove the persona quality on operator-triggered runs.

## Open questions (resolve before Task 1 ships)

1. **Persona model**: Sonnet (fast/cheap) vs Opus (better diversity) for the persona-evaluate calls? Default to Sonnet; bump to Opus per-persona if convergent hallucination shows up in calibration. Hedge: env var `PANEL_PERSONA_MODEL`, default `claude-sonnet-4-6`.
2. **Real-review priors source**: currently solopreneur-loop doesn't write `atoms/<slug>/review-*` to memory-hq. Need either (a) manual operator action to file reviews as atoms after Stripe checkouts, or (b) a Stripe-receipt webhook that fires a `request_review` email and ingests responses. Decide before Task 1 ships — without real priors, confidence ceiling is `'medium'`.
3. **Lens vocabulary**: starting set is `usability | conversion | value-prop | trust | friction`. Validate after first 10 panel runs; may need `pricing-clarity` or `mobile-first` additions.
4. **Confidence threshold for auto-route to optimizer (Task 7)**: spec uses `'low'` confidence + `>= 2 cut_consensus`. May need tuning; expose as env var `PANEL_AUTOROUTE_THRESHOLD` rather than hardcoding.
5. **Anti-collusion**: even with skepticism diversity, all personas share a base model. Worth adding a "devil's advocate" persona that's instructed to find reasons NOT to ship? Risk: it dominates the synthesis. Mitigation: cap dissent voices at 1 per panel.

## Progress

(empty — no work started)
