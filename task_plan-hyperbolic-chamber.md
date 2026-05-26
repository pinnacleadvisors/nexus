# Hyperbolic Chamber — time-compressed business simulation

> "Like a trading-strategy backtest, but for the business-operator agent. Compress 30 sim-days into 1 hour. Run with operator-in-the-loop, or let a heuristic auto-approver step through everything and read the verdict at the end."

## Goal
Operator launches a simulation that compresses N business-days of agent activity into a wallclock budget (~1 hour by default). Two modes — **manual** (operator approves every gate, like clicking "next bar" in TradingView replay) and **auto-pilot** (a deterministic heuristic decides; operator only reads the final stats). The output is a graded report: KPIs hit, approvals issued, errors logged, agent dispatches counted.

## Success criteria
- Operator clicks "Start simulation" on /businesses/[slug]/simulate → run is created in `simulation_runs`, timeline of synthetic events is generated, first event is presented.
- Manual mode: operator clicks "Next event" → exactly one event is processed, next pending state is returned. Approval gates surface as Approve/Reject UI; only operator's click advances them.
- Auto-pilot mode: operator picks a policy (permissive / skeptical / random), clicks "Run to completion" → engine processes every event in one call, returns final report with stats.
- All paid LLM dispatches inside a simulation are short-circuited by the existing simulation cost-guard (lib/cost-guard.ts) — sim runs cost $0.
- Final report shows: KPI hit/miss vs `business_operators.kpi_targets`, approval counts (manual or auto), error log, simulated revenue + cash spend.
- The 30 stale CodeQL alerts auto-close once main re-scans (PR #363 ships the final 4 real findings).

## Hard constraints
- **No real money moves.** The existing sim cost-guard + money-moving-verb classifier (`classifyMoneyMovingVerb` in lib/simulation/check.ts) MUST be honoured — every Composio dispatch from inside a sim run is rejected before the wire.
- **No paid LLM calls.** Agent dispatches inside a sim run record what would have been called, but never hit the gateway. Synthetic outputs come from templates seeded with the persona pool.
- **Deterministic replay.** Same `run_id` + same business state → same timeline. Use mulberry32 seeded from the run id.
- **Bounded wallclock.** Default 1-hour budget; engine aborts cleanly when budget elapses and writes a partial report. Cron-job.org's 26-failure auto-disable rule doesn't apply (these are operator-triggered, not cron-driven), but we still cap to prevent runaway loops.
- **One simulation per business at a time.** Migration adds a partial unique index on `simulation_runs(business_slug) WHERE status IN ('pending','running','paused')` so a second start while one is live returns the existing run.

## Phase 1 — this PR (scaffold + minimum viable)

### Task 1 — Migration 071
- File: `supabase/migrations/071_simulation_runs.sql`
- Change: create `simulation_runs` + `simulation_events`. Partial unique index on active runs per business. RLS service-role only.
- Verify: `psql -c "select * from simulation_runs limit 1"` returns 0 rows + no error.

### Task 2 — Timeline generator (Monte Carlo)
- File: `lib/simulation/timeline.ts`
- Change: `generateTimeline(seed: string, compress_days: number, business)` → `SimEvent[]`. Per sim-day: poisson(2) inbound tickets sampled from `SIM_PERSONAS`, geometric inter-event gaps, 1-3 agent actions, 0-2 approval gates, 1 EOD KPI snapshot. Tags every event with `sim_day` (0..N-1) and `sim_hour` (0..23.99).
- Verify: same seed → same event count + same order. Test in `tests/playwright/simulation-timeline.spec.ts`.

### Task 3 — Engine + grader
- File: `lib/simulation/engine.ts` (orchestrator) + `lib/simulation/grader.ts` (KPI evaluator)
- Change: `startRun(opts)` creates row; `tickOnce(runId)` processes ONE event (manual mode); `runToCompletion(runId)` processes all remaining (auto mode); `gradeRun(runId)` computes the final report. Engine writes to `simulation_events`, bumps `simulation_runs.current_sim_day`, sets status to `done` / `failed`.
- Verify: in-memory unit test seeds business + business_operators row, kicks startRun, calls runToCompletion, asserts `status='done'` and `result` is populated.

### Task 4 — Auto-approver heuristics
- File: `lib/simulation/auto-approver.ts`
- Change: `decideApproval(event, policy)` returns `{ decision: 'approve'|'reject', rationale }`. Policies:
  - **permissive**: approve unless event is in `approval_gates` of "irreversible" category (niche_pick, kill_experiment, pivot)
  - **skeptical**: approve only if event includes justification text matching a confidence keyword
  - **random**: 70% approve, 30% reject (PRNG seeded from run + event id for replay)
- Verify: pure function; unit test covers each policy × edge case.

### Task 5 — API surface
- Files: `app/api/simulations/route.ts` (POST create), `app/api/simulations/[id]/route.ts` (GET state), `app/api/simulations/[id]/tick/route.ts` (POST one step, manual), `app/api/simulations/[id]/run/route.ts` (POST run-to-completion, auto), `app/api/simulations/[id]/decide/route.ts` (POST operator approve/reject pending gate)
- Change: thin wrappers around lib/simulation/engine.ts. All return 200 + `{ok}` per retry-storm rule. Auth via `auth()` (operator-only).
- Verify: Playwright spec walks the full flow against the live deploy.

### Task 6 — Console UI
- File: `app/(protected)/businesses/[slug]/simulate/page.tsx` + `components/simulations/SimulationConsole.tsx`
- Change: simulate page shows existing/start form → console renders current state. Manual mode = "Next event" button + last-event card + approval prompt. Auto mode = progress bar + live stats + final report.
- Verify: open /businesses/sim-saas-01/simulate, start in manual mode, click through 5 events, switch to auto, run to completion, see graded report.

### Task 7 — Wire from business overview
- File: `app/(protected)/businesses/[slug]/page.tsx`
- Change: existing "Tick simulation" button gets a sibling "Run hyperbolic chamber" button (only on sim businesses). Click → routes to /simulate.
- Verify: button shows on sim-saas-01, navigates correctly.

## Phase 2 — future (LLM-flavoured personas, replay export, scheduled benchmarks)
- LLM-generated ticket bodies per persona (currently template-based for cost-zero)
- Replay export to JSON so a sim run can be re-played from disk
- Scheduled benchmark suite: nightly cron runs auto-pilot against a fixed test business, posts stats to Slack — drift = regression alarm

## Progress
### Completed
- [x] Step 0 — North Star written

### Remaining
- [ ] Task 1 — Migration 071
- [ ] Task 2 — Timeline generator
- [ ] Task 3 — Engine + grader
- [ ] Task 4 — Auto-approver heuristics
- [ ] Task 5 — API surface
- [ ] Task 6 — Console UI
- [ ] Task 7 — Wire from business overview

### Blockers / open questions
- None — design is unambiguous; implementation is mechanical.
