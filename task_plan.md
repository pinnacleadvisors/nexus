# Self-Optimising Ecosystem — Integration Plan

Goal: Stitch Nexus's existing agent, memory, board, and metrics surfaces into a closed idea → execution → measurement → self-optimisation loop, and close the confirmed auth gaps that would otherwise let an unauthenticated caller drain AI budget or exfiltrate storage.

Success criteria:
- A single persistent **Run** entity tracks an idea from forge card → PRD → decomposed tasks → build → launch → metrics → optimiser pass, and resumes across sessions from its last checkpoint.
- Queen context is assembled from the **knowledge graph** (molecular memory atoms + `lib/graph`) instead of full context blobs — measurable p50 token reduction ≥ 40% on swarm runs vs current baseline.
- `workflow-optimizer` is invoked by **both** paths: human feedback (already wired) **and** metric-drift triggers (new: CTR, conversion, token cost/outcome, review-reject rate).
- Every API route that calls Anthropic, OpenClaw, Supabase service-role, or R2 enforces `auth()` + rate-limit + per-user daily cost cap. No unauthenticated route can cost money.
- `ENCRYPTION_KEY` dev fallback removed; production fails closed; key rotation documented.
- A publish/distribute step (TikTok/IG/YouTube or provider of choice) exists so metrics can flow back and close the loop — without it the "self-optimising" claim is vapourware.
- `npx tsc --noEmit` passes; all new routes have a basic happy-path integration test.

Hard constraints:
- Stack rules in `AGENTS.md` / `memory/platform/STACK.md` (Next.js 16 App Router, `proxy.ts` not `middleware.ts`, `'use client'` boundary, all shared types in `lib/types.ts`, no `tailwind.config.js`).
- No secrets committed; every new env var added to `memory/platform/SECRETS.md`.
- Every new mutation endpoint: `auth()` → `ratelimit()` → CSRF origin check on POST → `audit.log()` write.
- Branch: `claude/plan-ecosystem-integration-Wvnzk`.
- **No auto-merge to main.** Human gate at the Board stays authoritative.
- Keep the dual-graph distinction: `memory/molecular/` = domain knowledge; `graphify-out/` = codebase structure. Don't conflate them.

---

## Phase 1 — Explore (findings)

### What already exists (the assets we're synergising)

**Orchestration kernel** (`lib/swarm/`):
- `Queen.ts` — `strategicDecompose` (Opus) + tactical routing + `AdaptiveQueen` replanning on drift
- `Router.ts`, `Consensus.ts`, `ReasoningBank.ts`, `TokenOptimiser.ts`, `WasmFastPath.ts`, `agents/registry.ts` (10+ specialist roles)
- Tavily live search wired for research roles

**Managed agents** (`.claude/agents/`): `agent-generator`, `n8n-strategist`, `workflow-optimizer`, `supermemory`, `firecrawl`, `nexus-memory`, `nexus-architect`, `nexus-tester`.

**Idea → workflow**: `/api/n8n/generate` emits executable n8n v1 JSON with per-step classification (managed-agent vs capability vs swarm) and asset-gated review nodes; `/api/claude-session/dispatch` auto-creates specs and injects `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` when swarm flag is set.

**Optimiser loop**: `components/board/ReviewModal.tsx` → `POST /api/workflow-feedback` → `workflow_feedback` table → `workflow-optimizer` agent → minimal diff to `.claude/agents/<slug>.md` → `workflow_changelog` row → `supermemory` atom.

**Knowledge graph**:
- Domain: `memory/molecular/{atoms,entities,mocs}` via `.claude/skills/molecularmemory_local/cli.mjs` (zero-token, pure Node)
- Code: `graphify-out/GRAPH_REPORT.md` if present; `lib/graph/builder.ts` (Louvain), `memory-builder.ts`
- Runtime: `lib/memory/github.ts` (Phase 20 GitHub PAT backend) + `/api/memory/*` read/write

**Metrics plumbing**: `/api/token-events` writes every model call with usage + cost; `/api/dashboard` aggregates; `/api/alerts` + `COST_ALERT_PER_RUN_USD` / `CLAW_DAILY_DISPATCH_CAP` env vars enforce soft caps. Inngest background at `/api/inngest` runs scheduled aggregation.

**Content + media**: Tribe v2 scoring (`/api/content/score`), variants (`/api/content/variants`), video generation (Kling/Runway wired; ElevenLabs/HeyGen/D-ID pending).

### What's missing to make the loop close

1. **No persistent Run state machine.** Each endpoint is a one-shot; the idea → spec → decomp → build → launch → metrics chain lives in n8n JSON with no first-class row in Supabase we can query. A restart loses context.
2. **Queen still ships full context** via `buildSwarmContext` + `optimiseContext` (text-level). No graph-keyed retrieval (`graph/query` → selected atoms only). This is the biggest token win still on the table.
3. **Feedback loop is human-only.** `workflow-optimizer` has no trigger path from metrics — no "ad CTR dropped below threshold → queue optimisation for content-writer agent".
4. **No publish step.** UGC is generated but there's no outbound distribution (TikTok/IG/YT/Reddit). Without it, CTR/conversion never comes back in, so the "self-optimising" loop has no measurement input.
5. **No experiment harness.** `/api/content/variants` exists but there's no run-tied A/B record that a later optimiser pass can read.
6. **ReasoningBank is instantiated but not read back.** No path that injects past successful reasoning into a new Queen decomposition.
7. **Phase 19 diff viewer + CI badge** (self-build loop) not shipped — the "platform improves itself" story needs it.

### Security findings (verified, not speculative)

All confirmed by reading the route headers + `grep auth`:

| Severity | Route | Issue |
|---|---|---|
| **Critical** | `GET/POST /api/chat` | Streams Anthropic/OpenClaw with no `auth()` check. Unauthenticated visitors can burn tokens. |
| **Critical** | `POST /api/content/generate` | AI content generation, no `auth()`. Same budget-drain vector. |
| **Critical** | `GET/POST/DELETE /api/r2` | Full R2 bucket CRUD with no auth; also accepts `{url}` for server-side fetch (classic SSRF). |
| **Critical** | `GET/POST/DELETE /api/storage` | Supabase Storage CRUD using `SUPABASE_SERVICE_ROLE_KEY` with no auth. Service role bypasses RLS. |
| **High** | `GET /api/audit` | Audit log disclosure to the public internet. |
| **High** | `lib/crypto.ts` | Dev fallback `ENCRYPTION_KEY` exists. In production-minus-env this silently encrypts OAuth tokens with a known key. Should fail closed. |
| **High** | CSP `'unsafe-eval'` in `script-src` | Needed for Next dev, but should be conditional on `NODE_ENV !== 'production'`. |
| **Medium** | `/api/claw/config` stores OpenClaw bearer in cookie (Phase 5 pending DB migration) | Cookie is `HttpOnly` but any XSS extension w/ session access sees the header. Move to encrypted DB column keyed by user_id. |
| **Medium** | `/api/swarm/dispatch`, `/api/content/*`, `/api/n8n/generate` | Have `createServerClient` but need explicit `auth()` gate + daily cost cap keyed by user_id. |
| **Medium** | No `CSRF` origin check applied to `/api/*` POSTs despite `lib/csrf.ts` existing. | Add middleware wrapper. |
| **Low** | `/api/r2` POST remote-url fetch | Allow-list egress (block RFC1918 + metadata IPs like `169.254.169.254`). |

**Good news (no action needed):** all three webhook receivers (`stripe`, `claw`, `n8n`) verify HMAC signatures correctly.

---

## Phase 2 — Plan

Three pillars, each independently valuable, each completing the loop when combined:
- **Pillar A — Ecosystem wiring** (the loop closes)
- **Pillar B — Security hardening** (the loop is safe to run)
- **Pillar C — Self-optimising performance** (the loop gets cheaper and smarter over time)

Task IDs are prefixed `A#`, `B#`, `C#` so they can be cherry-picked. Each task is 2–5 min of implementation. `Parallel: yes` tasks are safe to dispatch to subagents simultaneously.

### Pillar A — Close the idea → exec → optimise loop

#### A1 — Supabase migration: `runs` state machine
- File: `supabase/migrations/013_runs.sql` (new)
- Change: add `runs` table (`id uuid, user_id, idea_id, project_id, phase enum('ideate','spec','decompose','build','review','launch','measure','optimise','done'), status enum('pending','active','blocked','failed','done'), cursor jsonb, metrics jsonb, created_at, updated_at`). Add `run_events` append-only log keyed by `run_id`. RLS: user_id = `auth.jwt()->>'sub'`. Indexes on `(user_id, phase)` and `(run_id, created_at)`.
- Verify: `npm run migrate` applies cleanly; `select` as two different users shows only own rows.
- Parallel: yes.

#### A2 — Types for Run + RunEvent
- File: `lib/types.ts`
- Change: add `Run`, `RunPhase`, `RunStatus`, `RunEvent` interfaces. Add `RunMetrics` (CTR, conversion, tokenCost, reviewRejects, latencyP50).
- Verify: `npx tsc --noEmit`.
- Parallel: no (downstream tasks import these).

#### A3 — Run controller library
- File: `lib/runs/controller.ts` (new)
- Change: pure functions: `startRun(idea)`, `advancePhase(runId, to, payload)`, `appendEvent(runId, kind, payload)`, `getCursor(runId)`. Each phase transition writes an audit row and a `run_events` row. Never mutates state on failure (uses Supabase upsert with optimistic `updated_at` guard).
- Verify: unit test stub via `node --test` or existing test runner; no React imports.
- Parallel: depends on A2.

#### A4 — API route: `/api/runs`
- File: `app/api/runs/route.ts` (new) + `app/api/runs/[id]/route.ts` + `app/api/runs/[id]/advance/route.ts`
- Change: `GET /api/runs` list user's runs; `GET /api/runs/[id]` fetch + event log; `POST /api/runs/[id]/advance` phase transition. All three: `auth()` + rate-limit + CSRF origin.
- Verify: curl + authed cookie returns 401 without, 200 with.
- Parallel: depends on A3.

#### A5 — Wire forge idea → run creation
- File: `app/(protected)/forge/page.tsx` (edit) + `components/forge/ForgeActionBar.tsx`
- Change: "Build this" button calls `POST /api/runs` with `{ideaId}`, then routes to `/board?runId=...`. If a run already exists for the idea, resume it.
- Verify: click button; verify run row appears in Supabase; refresh → board shows the run card in whichever column matches `phase`.
- Parallel: depends on A4.

#### A6 — Run-aware session dispatch
- File: `app/api/claude-session/dispatch/route.ts` (edit)
- Change: accept optional `runId`; on completion append a `run_events` row with `kind='dispatch.completed'` + outputs; if the workflow step is the final one in a phase, call `advancePhase(runId, nextPhase)`.
- Verify: dispatch an n8n step manually → `run_events` log has the entry; phase advances as expected.
- Parallel: depends on A3.

#### A7 — Graph-keyed context retrieval for Queen
- File: `lib/swarm/TokenOptimiser.ts` (edit) + new `lib/swarm/GraphRetriever.ts`
- Change: before calling Claude, query `/api/graph/query` with role + keywords extracted from the goal, fetch only relevant atoms + entity summaries, then build a budget-aware prompt (hard cap at 12k tokens of retrieved context, fall back to `buildSwarmContext` if graph query returns nothing). Emit an event `graph.retrieved` with node IDs for observability.
- Verify: compare p50 input tokens on a canned 5-task swarm before/after; target 40% reduction; unit test asserts context size ≤ 12k tokens.
- Parallel: depends on A2.

#### A8 — ReasoningBank feedforward
- File: `lib/swarm/ReasoningBank.ts` (edit) + `lib/swarm/Queen.ts` (edit)
- Change: `strategicDecompose` loads top-k past successful decompositions for similar goals (cosine on goal embedding) and includes the shortest one as a few-shot example. When a run reaches `done`, write its plan back to ReasoningBank with outcome metrics.
- Verify: second run on a similar goal references prior plan in its output (emit event + manual eyeball).
- Parallel: depends on A7 (both touch context assembly — sequential safer).

#### A9 — Metric-triggered optimiser
- File: `lib/runs/metric-triggers.ts` (new) + `app/api/cron/metric-optimiser/route.ts` (new)
- Change: scheduled (Inngest or Vercel cron) scans `runs` + `workflow_changelog` + `token-events`. For each agent: if p95 token cost > budget AND last 5 runs failed review, enqueue a `workflow_feedback` row with `feedback = "metric-drift: <metric>=<value>"` and `agentSlug` inferred from `run_events`. The existing `workflow-optimizer` picks it up.
- Verify: seed fake metrics above threshold → row appears in `workflow_feedback`.
- Parallel: depends on A1.

#### A10 — Publish/distribute step
- File: `lib/publish/` (new) with `tiktok.ts`, `instagram.ts`, `youtube.ts` (stub with provider abstraction) + `app/api/publish/route.ts` (new)
- Change: implement **one** provider end-to-end first (recommend YouTube Shorts via official API — least friction, documented quota) with `publish(asset)` returning `{externalId, postedAt}`. Stub the other two with clear "not implemented" errors so the UI path is complete. Write the published ID back onto the Run so the measure phase can poll.
- Verify: manual dev-token publish to a test channel; returns external URL.
- Parallel: no — requires real API keys + owner approval before building; flag as human-gated decision.

#### A11 — Measure phase ingestion
- File: `app/api/cron/ingest-metrics/route.ts` (new) + `lib/publish/metrics.ts`
- Change: once per hour, for every run in `phase=measure`, poll platform analytics for `views, likes, ctr, conversions` (provider-specific). Update `runs.metrics` JSONB. When sample size threshold hit, advance to `optimise`.
- Verify: mock provider returns; run advances automatically.
- Parallel: depends on A10.

#### A12 — Self-build (Phase 19 closeout)
- File: `app/(protected)/board/components/DiffViewer.tsx` (new) + `app/api/build/diff/route.ts` (new) + `components/board/ReviewModal.tsx` (edit)
- Change: when a card's artifact is a git branch, render a unified diff in the modal with approve→merge / reject→close-branch buttons that POST to `/api/build/diff`. Uses existing OpenClaw worktree output. CI status badge via GitHub status API on the card.
- Verify: create a dummy feature branch → card shows diff → approve merges → close re-opens branch.
- Parallel: yes.

### Pillar B — Secure the platform

These are the critical findings verified in Phase 1. Do B1–B5 **before** shipping any Pillar A feature that spends real money.

#### B1 — Auth-gate `/api/chat`
- File: `app/api/chat/route.ts` (edit)
- Change: add `const { userId } = await auth(); if (!userId) return 401` as first line; then `ratelimit(userId, '/api/chat')` with a tighter bucket than the default (say 20/min + 500/day). Log to `audit.log('chat.stream', {userId, model})`.
- Verify: `curl -i http://localhost:3000/api/chat -X POST` returns 401; with auth cookie returns stream.
- Parallel: yes.

#### B2 — Auth-gate `/api/content/generate|score|variants`
- File: `app/api/content/generate/route.ts` + `score/route.ts` + `variants/route.ts` (edits)
- Change: same pattern — `auth()` + rate-limit + audit. `variants` additionally records `runId` + `variantId` if provided so A11 can join on it.
- Verify: unauthed 401; authed writes token-event row.
- Parallel: yes.

#### B3 — Auth-gate `/api/r2` + egress allowlist
- File: `app/api/r2/route.ts` (edit) + `lib/r2-url-guard.ts` (new)
- Change: `auth()` on all verbs. On POST `{url}` path, validate the URL via `r2-url-guard`: reject private IPs (RFC1918, loopback, link-local `169.254.0.0/16`, IPv6 private), reject non-`http(s)` schemes, follow at most 3 redirects with re-validation. Cap download size at 50 MB.
- Verify: POST `{url:"http://169.254.169.254/latest/meta-data"}` → 400; POST public URL under 50 MB → 201.
- Parallel: yes.

#### B4 — Auth-gate `/api/storage`
- File: `app/api/storage/route.ts` (edit)
- Change: `auth()` on all verbs. Scope `bucket`/`key` prefix to `user_id/<path>` — reject any request whose key does not start with the caller's user ID (prevents cross-user access even with service role).
- Verify: user A cannot list user B's prefix.
- Parallel: yes.

#### B5 — Auth-gate `/api/audit`
- File: `app/api/audit/route.ts` (edit)
- Change: `auth()`; force `userId` query param to equal the caller (owner can override via `ALLOWED_USER_IDS` membership check). Strip `resource`/`action` filters of SQL-sensitive chars (already parameterised but belt-and-braces).
- Verify: caller A cannot read B's audit; owner can read all.
- Parallel: yes.

#### B6 — Encryption key fail-closed
- File: `lib/crypto.ts` (edit)
- Change: in `production`, throw on import if `ENCRYPTION_KEY` unset or not 64 hex chars. Dev fallback remains but emits a loud console warning. Add `rotateKey(oldKey, newKey)` utility and document procedure in `memory/platform/SECRETS.md` (decrypt + re-encrypt all OAuth tokens in a single transaction).
- Verify: `NODE_ENV=production ENCRYPTION_KEY= node -e "require('./lib/crypto')"` throws.
- Parallel: yes.

#### B7 — CSP hardening
- File: `next.config.ts` (edit)
- Change: move `'unsafe-eval'` behind `process.env.NODE_ENV !== 'production'`. Add `Report-To` + `Content-Security-Policy-Report-Only` with a stricter draft (no `'unsafe-inline'` on scripts) and an endpoint `/api/csp-report` that collects violations for a week before enforcing.
- Verify: prod build inspects headers: no `'unsafe-eval'`; report-only header present.
- Parallel: yes.

#### B8 — CSRF origin check wrapper
- File: `lib/withGuards.ts` (new) + apply to all POST/PUT/DELETE handlers in `app/api/*`
- Change: a thin `withGuards(handler, {rateLimit, csrf:true})` wrapper that calls `assertOrigin(req)` (existing `lib/csrf.ts`), `auth()`, and `ratelimit(userId, route)`. Replace boilerplate in each route. Start with the 10 most-called routes, roll out behind a feature flag.
- Verify: cross-site fetch to any mutating route returns 403; same-origin works.
- Parallel: depends on B1–B5 (they get wrapped).

#### B9 — Per-user daily cost cap
- File: `lib/cost-guard.ts` (new) + hook into `token-events` write path
- Change: enforce `COST_ALERT_PER_RUN_USD` as a **block**, not just alert, when daily aggregate > `USER_DAILY_USD_LIMIT` (new env var, default $25). `withGuards` optionally accepts `{costCap:true}` and returns 402 when over.
- Verify: seed 26 USD of token-events for a user → next AI call returns 402.
- Parallel: depends on B8.

#### B10 — OpenClaw config → encrypted DB column
- File: `app/api/claw/config/route.ts` (edit) + new column on `profiles` or `agent_library`
- Change: migrate cookie-based gateway URL + bearer into `user_secrets` table (encrypted via `lib/crypto.ts`, RLS-scoped to user). Cookie flow becomes a fallback for backward compat, deprecation warning in logs. Remove after 30 days.
- Verify: existing users keep working; new users never see the bearer in client cookies.
- Parallel: yes (schema first, then route edit).

#### B11 — Secret-scanning pre-commit hook
- File: `.husky/pre-commit` (new) or `.git/hooks/pre-commit` + `scripts/scan-secrets.sh`
- Change: run `grep -rInE '(sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]+ PRIVATE KEY-----)' --include='*.ts' --include='*.md' --exclude-dir=node_modules` and fail the commit on hit. Pair with `gitleaks` config if already in CI.
- Verify: drop an `sk-test...` in a file → commit rejected.
- Parallel: yes.

#### B12 — Rate-limit audit on public surfaces
- File: `lib/ratelimit.ts` (edit) + README snippet
- Change: audit every public route (sign-in, OAuth callback, webhooks) for distinct buckets so a single abuser can't DOS auth. Document bucket strategy.
- Verify: automated script burst-tests each route; the intended limit triggers before a 5xx.
- Parallel: yes.

### Pillar C — Self-optimising performance

#### C1 — Observability: per-run + per-agent metrics
- File: `lib/observability.ts` (new), `supabase/migrations/014_run_metrics.sql`
- Change: `metric_samples` table (`run_id, agent_slug, kind, value, at`). Every swarm task emits `input_tokens`, `output_tokens`, `cache_hit_ratio`, `latency_ms`, `review_outcome`. Dashboard widget surfaces top-5 worst offenders.
- Verify: after a swarm run, table has rows; dashboard renders.
- Parallel: depends on A1 (runs table).

#### C2 — Regression detector
- File: `lib/observability/regression.ts` (new) + cron
- Change: daily job compares last-7-day vs last-24-hour p50/p95 per agent; flag > 25% regression as a `workflow_feedback` row with `status=open` and `feedback="perf-regression: <metric>"`. Closes the loop from perf to optimisation.
- Verify: inject synthetic regression → feedback row appears.
- Parallel: depends on C1 + A9.

#### C3 — Prompt cache hit rate optimiser
- File: `lib/swarm/TokenOptimiser.ts` (edit)
- Change: stable prompt prefixes for each role (system + graph preamble) are marked for Anthropic prompt caching. Measure cache-read vs cache-write tokens via `LanguageModelUsage.inputTokenDetails`; C1 records the ratio. Target ≥ 70% cache-read for repeated role/goal pairs.
- Verify: two identical swarm runs — second one reports high cacheReadTokens.
- Parallel: yes.

#### C4 — Library promotion on success
- File: `app/api/library/route.ts` (edit) + new `lib/library/promoter.ts`
- Change: when a run hits `done` with `metrics.ctr > threshold` (or `review_rejects == 0`), promote the generating prompt/agent output into `library` with a tag. Next similar goal hits the library first (already wired for read).
- Verify: successful content run → library row appears, tagged with `run_id`.
- Parallel: depends on A1.

#### C5 — Experiment harness (A/B)
- File: `supabase/migrations/015_experiments.sql`, `lib/experiments/` (new), `components/tools/ExperimentPanel.tsx`
- Change: `experiments(id, run_id, variant_a, variant_b, winner, confidence, sample_size)`. `/api/content/variants` writes both; publish step posts both (or alternates); measure phase picks winner at 95% confidence via z-test. Loser becomes a `workflow_feedback` with `feedback="lost-to: variant-<id>"`.
- Verify: two variants → after enough samples, winner column flips.
- Parallel: depends on A10, A11.

#### C6 — Adaptive routing feedback
- File: `lib/swarm/Router.ts` (edit — `updateRouter` already exists)
- Change: metric samples feed `updateRouter(role, agent, outcome)` so the Router prefers agents with higher review-approve + lower token cost over time. Decay old samples (exponential, 14-day half-life).
- Verify: synthetic bad-outcome samples for agent X → Router picks agent Y on next call.
- Parallel: depends on C1.

#### C7 — Graph-aware caching in `/api/chat`
- File: `app/api/chat/route.ts` (edit, after B1)
- Change: when user input maps to a known molecular atom or MOC, short-circuit with the cached answer + "refresh?" button. Saves tokens on repeat questions.
- Verify: ask the same question twice → second response is instant, flagged as cached.
- Parallel: depends on B1.

#### C8 — Nightly graph rebuild
- File: `app/api/cron/rebuild-graph/route.ts` (new)
- Change: nightly run of `cli.mjs graph` + `reindex` + `lib/graph/memory-builder.ts`. Commits to `memory/molecular/` if changed (via a low-privilege bot PAT or skipped when running on Vercel). Emits metrics: node count, orphan count, avg degree.
- Verify: trigger manually → INDEX.md + `.graph.json` refresh.
- Parallel: yes.

---

## Task Sequencing

### Critical path (ship security first, then loop, then performance)

```
B1,B2,B3,B4,B5,B6,B7  (parallel — all 7 can go in one commit)
   ↓
B8 → B9               (wrapper rollout + cost cap)
   ↓
A1 → A2 → A3 → A4     (runs state machine)
   ↓
A5,A6,A7              (wire forge + dispatch + graph retrieval — parallel)
   ↓
A8,A9                 (reasoning feedforward + metric trigger)
   ↓
C1 → C2,C3,C4,C6,C8   (observability, then parallel tuning)
   ↓
A10 → A11 → C5        (publish → measure → experiments — requires real API keys, human-gated)
   ↓
A12, C7, B10, B11, B12 (nice-to-haves, parallel)
```

### First commit (security blocker pack)

Ship B1–B7 as one PR titled `security: auth-gate public AI + storage routes`. This is the minimum-viable safety net — without it, running any Pillar A feature on the public internet leaks money.

### Second commit (ecosystem MVP)

A1 → A2 → A3 → A4 → A5 → A6. At this point a user can start a Run from the forge and see it progress through the Board with per-phase events. No measurement yet, but the spine exists.

### Third commit (feedback loop closes)

A7 → A8 → A9 → C1 → C2. Now the platform observes its own perf and queues optimisations automatically, plus Queen decompositions improve with each successful run.

### Fourth commit (distribution opens)

A10 → A11 → C5. Requires choosing a publish provider (recommend YouTube Shorts first — least friction). Human approval before this step because it involves real API keys and real posts.

## Risks

- **Run controller vs n8n parity.** If users already author n8n workflows manually, a Run entity in Supabase duplicates state. Mitigation: `runId` is a header/param on every dispatch; n8n workflows opt in. They are not mutually exclusive.
- **Graph retrieval empty.** New projects have no atoms, so A7's retrieval returns nothing and falls back to the old path. Acceptable — cold-start is the same as today.
- **YouTube API quotas.** Publish provider choice matters. If quota runs out, Run gets stuck in `publish` phase. Mitigation: provider abstraction so fallback to "manual publish" manual-gate node is trivial.
- **CSP report-only → enforce.** Expect a week of reports before tightening. Document the flip.
- **Workflow-optimizer auto-trigger storm.** A widespread metric regression could enqueue hundreds of feedback rows. Cap at 5 open rows per agent; anything above gets deduped with an incremented count.
- **Rate limiter cold start.** `lib/ratelimit.ts` falls back to in-memory when Upstash is unset, which breaks per-user caps across Vercel lambdas. Require `UPSTASH_REDIS_REST_URL` in production (B6-style fail-closed).

## PDCA gates (per CLAUDE.md)

| Gate | Check |
|---|---|
| After Explore | Scope matches North Star? (yes — three pillars map 1:1 to the three goals) |
| After B-pack commit | All 5 critical routes return 401 unauthenticated? |
| After A-pack commit | A run can be created from forge and shows `phase` transitions? |
| After C-pack commit | Dashboard shows p50 token reduction vs baseline? |
| Before launch of publish | Human owner signs off on publish provider + scopes in writing (comment in `ROADMAP.md`) |

## Progress (as of 2026-04-24)
### Completed
- [x] Phase 1 exploration (findings above)
- [x] Pillar C3 — prompt-cache prefix for Queen system prompts, cache stats fed into observability (`lib/swarm/TokenOptimiser.ts`, `lib/swarm/Queen.ts`)
- [x] Pillar C4 — `lib/library/promoter.ts` + hook in `advancePhase('done')`; manual re-promotion path on `POST /api/library { promoteRunId }`
- [x] Pillar C5 — `supabase/migrations/018_experiments.sql`, `lib/experiments/{types,client}.ts`, `POST/GET /api/experiments`, `components/tools/ExperimentPanel.tsx`. Two-proportion z-test decides winner at 95% confidence; loser auto-files `workflow_feedback`
- [x] Pillar C6 — Router Q-entries carry `updatedAt`; `updateRouter` applies 14-day exponential decay; `feedRouterFromMetricSamples` ingests observability data and runs nightly via the regression-sweep cron
- [x] Pillar C7 — `/api/chat` POST short-circuits with a cached graph-atom answer when one node dominates; emits audit + embeds `<graph-cache nodeId=…/>` marker for the UI "refresh?" affordance
- [x] Pillar C8 — `POST /api/cron/rebuild-graph` (owner-only) re-runs the molecular-memory CLI, rebuilds the in-process graph, and emits node/orphan/degree metrics via `metric_samples`

### Remaining
- [ ] Review this plan with the user and confirm scope/priority before implementation
- [ ] All tasks A1–A12, B1–B12, C1–C2

### Blockers / Open Questions
- Publish provider choice (YouTube Shorts? TikTok? All three?) — A10 blocked until decided
- Is there an existing Inngest cron setup I should use for A9/A11/C2/C8, or do we use Vercel cron? `/api/inngest` exists but the scheduled-function registration needs confirmation.
- Should the `runs` table be project-scoped (multi-business) or user-scoped (single-owner)? Phase 2 roadmap says multi-business is pending — I've designed for user-scoped with optional `project_id` to stay forward-compatible.

