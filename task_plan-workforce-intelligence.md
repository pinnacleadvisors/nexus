# Phase 23 — Workforce Intelligence

Distilled from the Kimi-swarm review of 2026-05-20 (see `Downloads/Kimi_Agent_Nexus%20Autonomous%20Upgrade/`). Five of Kimi's seven priorities are either already shipped, premature, or a complexity tax — this plan implements only the three patterns that genuinely raise the autonomy ceiling, plus two small wins.

## North Star

**Goal:** Make Nexus's existing managed-agent workforce measurably smarter at routing, recall, and recovery — without adding new vendors, models, or infrastructure dependencies.

**Success criteria:**
- `business-operator` and `solopreneur-loop` consult a per-agent capability score before dispatch (today they route blind).
- `memory_search` recall on a 10-query benchmark improves ≥30% over single-strategy retrieval (today's pgvector + FTS top-K).
- `workflow-optimizer` ingests recurring-failure traces from `run_events`, not just user review feedback. One recurring failure class → one durable rule atom in memory-hq.
- A new `research-synthesizer` managed agent converts raw research output into ICE-scored ranked action items.
- A `lib/media/router.ts` abstraction lets any agent step request media (`video|voice|image|music`) without hard-coding a provider.

**Hard constraints:**
- No new model providers (MiniMax / Kimi via OpenRouter is OUT — see "Out of scope").
- No new external infra (Redis semantic cache, GlitchTip, Playwright training — all OUT).
- No regression to the existing operator-gated loop pattern, `iteration-plan` blocks, or approval gates.
- No mutation of `connected_accounts`, `experiment_metrics` schema beyond additive columns.
- Prerequisite: `task_plan-claude-headless-cost-recovery.md` (Task G1 cost spike) lands first — if dispatched Claude is API-billed, intelligent routing becomes urgent rather than nice-to-have.

## Phase 1 — Explore (2026-05-20, done in chat)

Reviewed: Kimi plan sections 1, 3, 4, cross-verification report, insight extraction. Mapped each Kimi priority to Nexus current state. Identified `memory-hq` is canonical for memory, `lib/cost-guard.ts` already handles kill switches, `lib/health/circuit-breaker.ts` handles self-healing, Sentry handles observability. Three real gaps remain: capability scoring, multi-strategy retrieval, execution-trace rule extraction. Two adjacent wins: research synthesizer, media router.

## Phase 2 — Plan

### Task 1 — Hindsight-style multi-strategy retrieval in `memory_search`

- **Files:** `app/api/memory/query/route.ts`, `services/mcp-memory/src/index.ts`
- **Change:** Replace single-strategy ranking with three parallel retrievers (dense pgvector, sparse FTS/BM25, recency-weighted) merged by Reciprocal Rank Fusion (RRF, k=60). Default `mode=hybrid`; keep `mode=dense|sparse` for A/B.
- **Verify:** Curate 10 known-good queries against memory-hq (mix of factual recall, multi-hop, temporal). Score recall@5 before vs after. Target ≥30% recall lift.
- **Parallel:** no (touches the shared retrieval primitive that Tasks 3+6 use)
- **Risk:** RRF can over-weight stale FTS hits; mitigate with a `recency_decay_days` parameter defaulting to 90.

### Task 2 — Per-agent capability/trust scoring

- **Files:** `supabase/migrations/039_agent_capability_scores.sql` (new), `lib/agents/scoring.ts` (new), light updates in `business-operator.md` + `solopreneur-loop.md` to consume.
- **Change:** Add columns `agent_id text`, `task_type text`, `success boolean`, `duration_ms int`, `cost_usd numeric` to `experiment_metrics`. Create view `agent_capability_scores` that aggregates `success_rate`, `mean_cost`, `p95_duration` per `(agent_id, task_type, business_slug)` over a rolling 30-day window. Operator agents query the view via a new helper `getAgentForTask(taskType, businessSlug)` that returns the top-ranked available agent.
- **Verify:** Migration applies idempotently. After one `solopreneur-loop` cycle, the view has ≥3 rows. Manually verify the routing decision in the next cycle matches the view's top-ranked agent.
- **Parallel:** yes (no deps on Task 1)
- **Risk:** Cold-start — no data on day 1. Mitigate by seeding capability rows from the existing managed-agent descriptions (declarative bootstrap).

### Task 3 — `research-synthesizer` managed agent

- **Files:** `.claude/agents/research-synthesizer.md` (new), `lib/agents/synthesize.ts` (new helper), registry row via existing `POST /api/agents`.
- **Change:** New managed agent. Input: raw research output (Tavily JSON, Firecrawl markdown, or a pasted document). Output: typed `synthesis-output` block with ranked action items — each carrying `impact (1-5)`, `confidence (1-5)`, `ease (1-5)`, `ice_score`, `est_hours`, `rationale`. Plugs into the existing operator-gated loop pattern; emits the block, awaits approval, no autonomous side effects.
- **Verify:** Run against the five Kimi research dim files in `Downloads/Kimi_Agent_Nexus%20Autonomous%20Upgrade/research/`. Expected: ≥10 ranked items; top-3 match items I called out in chat (Hindsight retrieval, capability scoring, media router).
- **Parallel:** yes (no deps)
- **Risk:** ICE scoring is subjective; mitigate by requiring the agent to cite the source-document line numbers in `rationale` so the operator can sanity-check.

### Task 4 — ACE-style execution-trace ingestion in `workflow-optimizer`

- **Files:** `.claude/agents/workflow-optimizer.md`, `app/api/workflow-feedback/route.ts`, new `app/api/cron/extract-failure-rules/route.ts`.
- **Change:** `/api/workflow-feedback` already accepts `{summary, details, source}`. Add a daily cron at `/api/cron/extract-failure-rules` that groups `run_events` with `status='failure'` over the prior 7 days by `(error_class, agent_id, task_type)`, picks classes with `count >= 3`, dispatches each to `workflow-optimizer` with a pre-formatted synthetic-feedback payload. The optimizer's existing diff-then-apply-then-log flow runs unchanged. The new wrinkle: on apply, ALSO write a memory-hq atom (`kind: rule`, `importance: high`, links to the relevant MOC) so the rule is queryable across sessions.
- **Verify:** Force a synthetic failure cluster (3 fake n8n 503 events) into `run_events`. Run the cron manually. Confirm: one workflow-optimizer dispatch fires; the resulting diff includes a backoff change; one new atom appears in memory-hq under `atoms/55bedf46-nexus/`.
- **Parallel:** yes (depends on Task 2 for the `agent_id` column on `experiment_metrics` — can start in parallel and rebase after migration lands).
- **Risk:** Cron loops are a retry-storm vector. Apply the AGENTS.md retry-storm checklist verbatim — return 200 + `{ok:false}` on partial failure, idempotency via `claimEvent('failure-rule', cluster_hash)`.

### Task 5 — `lib/media/router.ts` — fal.ai-style unified media gateway

- **Files:** `lib/media/router.ts` (new), `lib/media/providers/{kling,runway,elevenlabs,heygen,muapi,suno}.ts` (new, one provider per file), `lib/media/ranking.ts` (new).
- **Change:** `generateMedia({type, prompt, budgetUsd?, qualityTier?, businessSlug})` where `type ∈ {'video','voiceover','image','music','talking-head'}`. The router:
  1. calls `checkKillSwitch(businessSlug)` first;
  2. resolves provider keys from per-business container env (apiKeySetup providers in `lib/oauth/providers.ts`);
  3. picks provider from a static ranking table keyed by `(type, qualityTier, budgetUsd)` — start with the 7 already-listed providers, no need for 200;
  4. tags every external object with `metadata.business_slug` (mirrors the shared-Stripe-Vercel pattern in `docs/runbooks/shared-stripe-vercel.md`);
  5. persists `provider`, `cost_usd`, `latency_ms`, `success` to `experiment_metrics` so Task 2's `agent_capability_scores` view can rank providers over time alongside agents.
- **Verify:** Unit test per provider mocks the upstream API and asserts payload shape. One integration test for the happy path: `generateMedia({type:'voiceover', prompt:'Hello', businessSlug:'pdf-info-products'})` → returns an ElevenLabs URL.
- **Parallel:** yes (no deps on Tasks 1-4)
- **Risk:** Provider API drift. Mitigate by versioning each provider file and pinning the API endpoint version. Don't share `node-fetch` mocks across providers — each provider has its own auth handshake.

### Task 6 — `memory_workflow_match` MCP tool

- **Files:** `services/mcp-memory/src/index.ts`
- **Change:** New MCP tool `memory_workflow_match({niche, money_model, business_slug?}) → top 5 ranked atoms`. Queries memory-hq for entities tagged `business` and atoms tagged `workflow`. Ranking blends Task 1's hybrid retrieval with a niche-similarity term (Jaccard over content pillars). Returns slugs + RRF scores + a short rationale per match.
- **Verify:** Query `{niche:'pdf-info-products', money_model:'direct'}` → returns the solopreneur-loop workflow at top rank. Query `{niche:'completely-novel'}` → returns the 5 most generally-applicable workflows (not a hallucinated match).
- **Parallel:** yes (depends on Task 1 for best results; can ship a single-strategy version first and upgrade after Task 1 merges).
- **Risk:** The "no good match" case must return low scores honestly rather than ranking weak matches; assert that the lowest score in the top-5 is above a configurable floor or the caller treats the response as empty.

## Out-of-scope (explicit deferrals from Kimi plan)

- **Multi-provider model router (MiniMax + Kimi via OpenRouter)** — re-evaluate ONLY if `task_plan-claude-headless-cost-recovery.md` fails to recover the 20x Max economics. Otherwise the operational complexity is not worth the marginal savings.
- **Semantic Redis caching layer** — Claude native prompt caching covers ~80% of repeat-query value at zero ops cost. Build only if a measurable workload shows redundant calls.
- **GlitchTip migration** — Sentry is on a sampler budget cap (per AGENTS.md) and works. No migration during active product work.
- **Visual failure dashboard `/admin/failures`** — Sentry already does this. Don't fork.
- **Playwright platform-expertise training** — Composio + per-business MCP set already covers ≥150 platforms via OAuth. Revisit only for the long tail.
- **Stripe metered billing to end users** — Nexus is not selling to third parties yet.
- **AI influencer persona schema** — product feature, not infrastructure. Build when a specific business needs it.
- **Agent Tower council/debate modes** — operator-gated loop already provides single-point judgement; multi-agent debate would mostly burn tokens.
- **Hindsight Docker container deployment** — we're implementing the *pattern* (multi-strategy retrieval) directly in `memory_search` without adding a new container. Kimi confused the pattern with the project.

## Progress

_None yet — plan written 2026-05-20. Operator approval needed on Tasks 1-6 ordering and on the prerequisite assumption (cost-recovery plan lands Task G1 first)._

## Sequencing

```
Week 1   Task 1 (retrieval upgrade)         ← unblocks Tasks 3 + 6 quality
Week 1   Task 2 (capability scoring)        ← parallel, independent surface
Week 2   Task 3 (research-synthesizer)      ← depends on Task 1 quality
Week 2-3 Task 4 (failure-trace ingestion)   ← depends on Task 2 schema column
Week 3-4 Task 5 (media router)              ← independent
Week 4   Task 6 (memory_workflow_match)     ← depends on Task 1 + Task 5 telemetry
```

Total ~4 calendar weeks, ~30 focused engineering hours. Every task lands its own PR. Every task ships independently (no big-bang merge).
