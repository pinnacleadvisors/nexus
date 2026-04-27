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
- `memory/molecular/` is the single domain knowledge graph (built by `/molecularmemory_local`). The `/graphify` plugin and `graphify-out/` tree are no longer part of this repo — do not re-introduce.

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
- Code structure heuristics: `lib/graph/builder.ts` (force-layout + Louvain), `memory-builder.ts` — derived on demand; no persisted graphify report
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

> Verified against the filesystem — this section is the source of truth for SOE phase status. Mirrored into `memory/roadmap/SUMMARY.md` (SOE table). Memory write path: on every pillar task completion, update both this section AND `memory/roadmap/SUMMARY.md` + `memory/roadmap/PENDING.md`.

### Completed — Pillar A (loop closure)
- [x] **A1** — `supabase/migrations/015_runs.sql` (runs + run_events, RLS scoped to user_id)
- [x] **A2** — `Run`, `RunPhase`, `RunStatus`, `RunEvent`, `RunMetrics` in `lib/types.ts`
- [x] **A3** — `lib/runs/controller.ts` (`startRun`, `advancePhase`, `appendEvent`, `getCursor`, optimistic `updated_at` guard)
- [x] **A4** — `app/api/runs/route.ts` + `app/api/runs/[id]/route.ts` (list / fetch / advance, all auth-gated)
- [x] **A5** — `components/forge/ForgeActionBar.tsx` "Build this" button → `POST /api/runs` → `router.push('/board?runId=...')`; `components/forge/ForgeSession.tsx` threads `ideaId`; `/board` reads the query param and renders an active-run banner populated from `/api/runs/[id]`. Idempotent resume is handled by `startRun()` server-side.
- [x] **A6** — `app/api/claude-session/dispatch/route.ts` accepts `runId`, appends `run_events`, calls `advancePhase` at phase boundary
- [x] **A7** — `lib/swarm/GraphRetriever.ts` + TokenOptimiser integration (budget-capped retrieval with fallback to `buildSwarmContext`)
- [x] **A8** — ReasoningBank feedforward in `lib/swarm/Queen.ts` (`strategicDecompose` loads past successful plans; `migrations/016_plan_patterns.sql` stores them)
- [x] **A9** — `lib/runs/metric-triggers.ts` + `app/api/cron/metric-optimiser/route.ts` (files metric-drift `workflow_feedback` rows)
- [x] **A10** — `lib/publish/{youtube,tiktok,instagram,metrics,index,types}.ts` + `app/api/publish/route.ts` (YouTube live; TikTok + IG stubbed pending app review)
- [x] **A11** — `lib/runs/measure-ingester.ts` + `app/api/cron/ingest-metrics/route.ts`
- [x] **A12** — `components/board/DiffViewer.tsx` + `app/api/build/diff/route.ts` + ReviewModal integration

### Completed — Pillar B (security)
- [x] **B1** — `/api/chat` auth-gated
- [x] **B2** — `/api/content/{generate,score,variants}` auth-gated
- [x] **B3** — `lib/r2-url-guard.ts` + `/api/r2` auth-gated with RFC1918/metadata IP block
- [x] **B4** — `/api/storage` auth-gated + user-id prefix scoping
- [x] **B5** — `/api/audit` auth-gated
- [x] **B6** — `lib/crypto.ts` throws in production when `ENCRYPTION_KEY` unset or invalid; dev fallback logs loud warning
- [x] **B7** — `next.config.ts` gates `unsafe-eval` on `NODE_ENV !== 'production'`
- [x] **B9** — `lib/cost-guard.ts` returns 402 when user crosses `USER_DAILY_USD_LIMIT` (default $25)
- [x] **B10** — `supabase/migrations/014_user_secrets.sql` + encrypted `user_secrets` storage for `/api/claw/config` (cookie flow deprecated)

### Completed — Pillar C (self-optimising performance)
- [x] **C1** — `lib/observability.ts` + `supabase/migrations/017_metric_samples.sql`
- [x] **C2** — `lib/observability/regression.ts` + `app/api/cron/regression-sweep/route.ts`
- [x] **C3** — prompt-cache prefix for Queen system prompts, cache stats fed into observability (`lib/swarm/TokenOptimiser.ts`, `lib/swarm/Queen.ts`)
- [x] **C4** — `lib/library/promoter.ts` + hook in `advancePhase('done')`; manual re-promotion path on `POST /api/library { promoteRunId }`
- [x] **C5** — `supabase/migrations/018_experiments.sql`, `lib/experiments/{types,client}.ts`, `POST/GET /api/experiments`, `components/tools/ExperimentPanel.tsx`. Two-proportion z-test decides winner at 95% confidence; loser auto-files `workflow_feedback`
- [x] **C6** — Router Q-entries carry `updatedAt`; `updateRouter` applies 14-day exponential decay; `feedRouterFromMetricSamples` ingests observability data and runs nightly via the regression-sweep cron
- [x] **C7** — `/api/chat` POST short-circuits with a cached graph-atom answer when one node dominates; emits audit + embeds `<graph-cache nodeId=…/>` marker for the UI "refresh?" affordance
- [x] **C8** — `POST /api/cron/rebuild-graph` (owner-only) re-runs the molecular-memory CLI, rebuilds the in-process graph, and emits node/orphan/degree metrics via `metric_samples`

### Synergy check (cross-pillar integration verified)

- ✅ **A1 ⇄ C1** — `metric_samples.run_id` FK aligns with `runs.id`; observability per-run is queryable
- ✅ **A6 ⇄ A8** — dispatch run-events feed ReasoningBank's outcome labels for future feedforward
- ✅ **A7 ⇄ C3** — GraphRetriever output is the stable prefix marked for Anthropic prompt caching (no redundant context regeneration)
- ✅ **A9 ⇄ C2** — regression detector writes to the same `workflow_feedback` surface metric-triggers use; workflow-optimizer reads a single inbox
- ✅ **A11 ⇄ C5** — experiment winner selection reads `runs.metrics` after ingest-metrics populates it
- ✅ **A12 ⇄ C4** — successful run branch diff → library promotion uses the same `run_id` lineage
- ✅ **B6 ⇄ B10** — user_secrets encryption fails closed in production, so the claw-config migration is safe to rely on
- ✅ **B9 ⇄ C1** — cost-guard 402 response is recorded in `metric_samples` as a budget event for later analysis
- ✅ **A5 → A6 → downstream** — the forge entrypoint now creates (or resumes) a Run, and the existing A6/A9/A11/C1 plumbing continues from there. Loop is user-facing.
- ⚠️ **B8/B11/B12 hygiene gaps** — guards are wired per-route rather than via a `withGuards` wrapper; pre-commit secret scan exists as a script but no husky hook installs it. Low severity given B1–B7 + B9/B10 cover the critical money/data paths.

### Remaining
- [ ] **B8** — introduce `lib/withGuards.ts` wrapper (origin + auth + ratelimit + optional costCap); migrate top 10 mutating routes behind a feature flag
- [ ] **B11** — wire `scripts/scan-secrets.sh` into `.husky/pre-commit`
- [ ] **B12** — audit every public surface (sign-in, OAuth callback, webhooks) for distinct rate-limit buckets; document strategy in `lib/ratelimit.ts`
- [ ] TikTok + Instagram providers in `lib/publish/` once app review clears
- [ ] Phase 19 closeout — error-paste mode + CI status badge on Board cards

### Blockers / Open Questions
- Inngest vs Vercel cron — the A9/A11/C2/C8 routes are registered as `app/api/cron/*` but the scheduled-function registration (Inngest `inngest.cron(...)` or `vercel.json` cron) needs confirmation.
- Publish provider app-review timelines for TikTok + Instagram. YouTube Shorts is live.
- Once A5 lands, decide whether the forge should also offer a "dry-run" mode that creates a run with `phase=spec` but halts before `build` — cheaper exploration for uncertain ideas.

---

# Sub-Plan — Roadmap → Molecular Memory split

Goal: Replace bulk reads of `ROADMAP.md` (917 lines / ~19k tokens) with token-efficient `molecularmemory_local` queries, so Phase 1 of the Long-Horizon Protocol can pull only the relevant phase context into Messages.

Success criteria:
- 22 phase MOCs exist under `memory/molecular/mocs/phase-NN-<slug>.md`, each linking that phase's status + pending atoms.
- ~30–50 atoms exist under `memory/molecular/atoms/` covering pending items and key design decisions (not exhaustive — completed-item history stays in `ROADMAP.md`).
- `node .claude/skills/molecularmemory_local/cli.mjs query "<phase-keyword>"` returns the right MOC + atoms.
- `cli.mjs reindex` regenerates `memory/molecular/INDEX.md` listing the new MOCs/atoms.
- `CLAUDE.md` Long-Horizon Protocol Phase 1 ("Explore") explicitly tells agents: query molecular memory FIRST, then `memory/roadmap/SUMMARY.md`, only fall back to `ROADMAP.md` for human-readable manual-step text.
- Total Messages cost for "what's pending in Phase 17?" drops from ~19k tokens (read ROADMAP) to <1k (query → MOC → 2 atoms).

Hard constraints:
- Do **not** delete or shrink `ROADMAP.md` — it stays as the human-readable source of truth and contains manual setup steps used during deploy.
- Do **not** fragment `task_plan.md` or `INTEGRATION_STRATEGY.md` — those are active working docs, not reference material.
- Do **not** modify any application code (`app/`, `lib/`, `components/`).
- Existing `memory/roadmap/SUMMARY.md` and `PENDING.md` stay; molecular layer sits below them as finer-grained retrieval.
- Follow `molecularmemory_local` SKILL.md exactly: YAML frontmatter, slug = filename, [[wikilinks]] for edges, no tags.
- Keep this whole sub-plan reversible: every artifact is a new file under `memory/molecular/`; no destructive edits.

## Phase 1 — Explore (done in conversation)

Findings:
- `ROADMAP.md`: 917 lines, 22 phases + Manual Steps + Tech Stack + Immediate Next Steps headers identified.
- `molecularmemory_local` CLI: `init | atom | entity | moc | link | graph | query | reindex` (signatures in `.claude/skills/molecularmemory_local/SKILL.md`).
- Existing molecular memory: 1 MOC (`nexus-agent-library`), 4 entities, 5 atoms — coexists, doesn't conflict.
- Existing `memory/roadmap/SUMMARY.md` already gives a 22-row phase status table at ~5.5k bytes (vs 74k for ROADMAP). Molecular split is the next granularity level below that.

## Phase 2 — Plan (atomic tasks)

### Task R1 — Confirm molecular dirs
- File: `memory/molecular/{atoms,entities,mocs}/`
- Change: run `node .claude/skills/molecularmemory_local/cli.mjs init` (idempotent — dirs already exist).
- Verify: command returns `{"ok":true}`.
- Parallel: no (one-shot prep step).

### Tasks R2–R23 — One MOC per phase
- File: `memory/molecular/mocs/phase-NN-<slug>.md` for N = 1..22
- Change: `cli.mjs moc "Phase N — <title>" --description="<one-line summary from SUMMARY.md>"`
- Each MOC's body lists: status (✅/🔧/⬜), one-line scope, `Pending` section (links to atoms — see R24+), `References` section (link back to `ROADMAP.md` line range).
- Verify: file exists, frontmatter has `type: moc`, body has at least 1 [[wikilink]] (will be filled by R24+).
- Parallel: yes — all 22 can run together.

### Tasks R24–R5x — Atoms for pending items + key design decisions
- File: `memory/molecular/atoms/<slug>.md`
- Source: `memory/roadmap/PENDING.md` (every ⬜ bullet → 1 atom) + design-decision blocks in `ROADMAP.md` (e.g. Phase 19 "GitHub repo as free Notion", Phase 21 "Leiden vs Louvain").
- Estimated count: ~30 pending atoms + ~10 decision atoms = **~40 atoms total**.
- Each atom: `cli.mjs atom "<title>" --fact="<one-sentence>" --source=ROADMAP.md#L<line> --links=phase-NN-<slug>`
- Verify: atom file exists with `type: atom` frontmatter, source URL present, at least one outbound link to its phase MOC.
- Parallel: yes — all atoms in one batch (40 CLI calls).

### Task R-Graph — Rebuild adjacency
- File: `memory/molecular/.graph.json`
- Change: `cli.mjs graph`
- Verify: prints `{nodes: ~70, edges: ~120, orphans: 0|low, hubs: [...]}`. Zero orphans means every atom links to its phase MOC.
- Parallel: no (depends on R2–R5x).

### Task R-Reindex — Regenerate molecular INDEX.md
- File: `memory/molecular/INDEX.md`
- Change: `cli.mjs reindex`
- Verify: `grep -c "phase-" memory/molecular/INDEX.md` ≥ 22; INDEX shows MOC count = 23 (existing + 22 new).
- Parallel: no (after R-Graph).

### Task R-Protocol — Update CLAUDE.md to query molecular memory first
- File: `CLAUDE.md` — `# Knowledge Graph` section + `Long-Horizon Task Protocol > Phase 1 — Explore`
- Change: add line:
  > Before reading `ROADMAP.md`, run `node .claude/skills/molecularmemory_local/cli.mjs query "<phase-or-feature>"` to pull only the relevant MOC + atoms. Read `ROADMAP.md` directly only for manual setup steps or human-readable narrative the molecular notes do not cover.
- Verify: `grep -n "cli.mjs query" CLAUDE.md` returns ≥ 1 line in the Phase 1 section.
- Parallel: no (final step).

### Task R-Header — Add agent breadcrumb to ROADMAP.md
- File: `ROADMAP.md` line 1–3
- Change: insert a 2-line note above the title: "AI agents: query `memory/molecular/` first via `/molecularmemory_local query <topic>`. This file is the human source of truth and contains manual-step text not always atomised."
- Verify: line 1 contains "AI agents:".
- Parallel: no.

## Phase 3 — Implement (gated on user approval)

Order: R1 → batch (R2–R23 parallel) → batch (R24–R5x parallel) → R-Graph → R-Reindex → R-Protocol → R-Header → commit.

Two-stage review after each batch returns:
1. Spec compliance — every MOC has frontmatter + at least one link; every atom has a `--source` line.
2. Token-cost smoke test — pick three phases (e.g. 17, 19, 22), run `cli.mjs query` for each, confirm result < 1k tokens vs reading ROADMAP.

## Risk register

| Risk | Mitigation |
|---|---|
| 40 atoms = noisy graph; orphan atoms | Every atom call uses `--links=<phase-MOC>` so no orphans by construction; `cli.mjs graph` orphans count must be 0 before R-Reindex. |
| Drift between ROADMAP.md and molecular notes | Atom `--source=ROADMAP.md#Lxxx` is the audit trail; future ROADMAP edits should re-run a delta script (out of scope here, document as follow-up). |
| MOC titles collide with existing slugs | Phase MOCs use `phase-NN-<slug>` prefix — deterministic, no collision with existing `nexus-agent-library` MOC. |
| Maintenance overhead exceeds benefit | Scope limited to pending items + key decisions, not full ROADMAP atomisation. Completed-item history stays in ROADMAP only. |
| User wants different layout (e.g. `memory/roadmap/` not `memory/molecular/`) | Keep ROADMAP-derived MOCs/atoms separable — easy to `git mv` later if structure changes. |

## Token-cost projection

| Query | Before (read ROADMAP.md) | After (cli.mjs query → MOC → atoms) | Saving |
|---|---|---|---|
| "What's pending in Phase 17?" | ~19k tokens | ~600 tokens | 96% |
| "Tell me about the Leiden vs Louvain decision" | ~19k tokens | ~250 tokens | 99% |
| "List all not-started items" | ~19k tokens | already covered by `PENDING.md` ~1k | unchanged |

## Progress (sub-plan)
### Completed
- [x] Phase 1 exploration (this conversation)
- [x] Phase 2 atomic plan written (this entry)

### Remaining
- [ ] User approval of scope (open question — confirm before R1)
- [ ] R1 → R-Header implementation

### User answers (2026-04-25)
1. **Atomise every ROADMAP bullet** (~150 atoms target).
2. **Location** = `memory/roadmap/molecular/` (separate namespace; existing `memory/molecular/` untouched).
3. **Keep `ROADMAP.md`** as human source of truth.
4. **Same treatment** for `INTEGRATION_STRATEGY.md` → `memory/integration/molecular/`, and `task_plan.md` → `memory/tasks/molecular/` (with ongoing protocol: every new task_plan.md entry gets atomised at task completion to track features-implemented over time).

## Refined scope (post-approval)

Three molecular namespaces, atomised by parallel subagents:

| Source | Namespace | Target atoms | Target MOCs |
|---|---|---|---|
| `ROADMAP.md` (74.7k bytes, 917 lines, 22 phases) | `memory/roadmap/molecular/` | ~150 (every phase bullet + manual-step + decision block) | 22 phase MOCs + 1 "Manual Steps" MOC + 1 "Tech Stack" MOC = 24 |
| `INTEGRATION_STRATEGY.md` (17.6k bytes, 439 lines, 5 patterns) | `memory/integration/molecular/` | ~50 (every pattern step + checklist item + dependency edge) | 5 pattern MOCs + 1 "Checklist" MOC + 1 "n8n-vs-OpenClaw" MOC = 7 |
| `task_plan.md` (current — Self-Optimising Ecosystem + Roadmap-split sub-plan) | `memory/tasks/molecular/` | ~80 (every A/B/C task + every R task + every risk + every progress entry) | 3 plan MOCs (A-pack, B-pack, C-pack) + 1 sub-plan MOC = 4 |
| **Total** | | **~280 atoms** | **~35 MOCs** |

## Implementation status (live)

- [x] Patch `cli.mjs` to read `MOLECULAR_ROOT` env var (line 8 — fallback to `memory/molecular`).
- [x] `init` all three namespaces — verified `INDEX.md` + `atoms/` + `entities/` + `mocs/` exist in each.
- [ ] Subagent A: `ROADMAP.md` → `memory/roadmap/molecular/`
- [ ] Subagent B: `INTEGRATION_STRATEGY.md` → `memory/integration/molecular/`
- [ ] Subagent C: `task_plan.md` → `memory/tasks/molecular/`
- [ ] Run `cli.mjs graph` + `cli.mjs reindex` per namespace.
- [ ] Update `CLAUDE.md` Long-Horizon Protocol to query molecular memory first; add cross-namespace query guidance.
- [ ] Update `AGENTS.md` Platform Memory section with three new namespaces.
- [ ] Add "AI agents query first" breadcrumbs to all three source files.
- [ ] Add ongoing protocol to `CLAUDE.md`: Phase 3 PDCA gate now includes "atomise newly added task_plan entries" before commit.
- [ ] Final commit + push.

## Cross-namespace query strategy

When the Long-Horizon Protocol's Explore phase needs roadmap/integration/task context, the agent runs:

```bash
MOLECULAR_ROOT=memory/roadmap/molecular     node .claude/skills/molecularmemory_local/cli.mjs query "<text>"
MOLECULAR_ROOT=memory/integration/molecular node .claude/skills/molecularmemory_local/cli.mjs query "<text>"
MOLECULAR_ROOT=memory/tasks/molecular       node .claude/skills/molecularmemory_local/cli.mjs query "<text>"
```

Three small JSON results merged in-context, then read only the few atoms they point to. Saves 100k+ tokens vs reading all three source files.

## Ongoing protocol (per user request #4)

When a task_plan.md entry transitions to "Completed", the implementing agent must:
1. Run `MOLECULAR_ROOT=memory/tasks/molecular cli.mjs atom "<task title>" --fact="<one-sentence outcome>" --source=task_plan.md#L<line> --links=<phase-MOC>,<feature-MOC>` for each completed task.
2. Run `MOLECULAR_ROOT=memory/tasks/molecular cli.mjs graph && reindex`.
3. Commit with message `molecular(tasks): <task-id> closeout`.

This is documented as a new PDCA gate in `CLAUDE.md` so the molecular task memory accretes alongside `task_plan.md` instead of going stale.

---

# Sub-Plan — Felixcraft adoption + multi-OpenClaw cloud fleet + PDF storefront

> Source: `docs/pdfs/How-to-Hire-an-AI.pdf` (Felix Craft / Nat Eliason, 66 pages, ingested 2026-04-26).
> Branch: `claude/add-pdf-support-iixjA`. PR: pinnacleadvisors/nexus#45.

## North Star

**Goal**: Adopt the most additive Felixcraft patterns into Nexus (multi-instance OpenClaw fleet, messaging surface, atomic-fact decay, semantic vector search over molecular memory, autonomous Sentry→fix pipeline, daily notes layer), then use the upgraded platform to ship a productized "PDF business" run template — Nexus's first commercial output.

**Success criteria** (verifiable):
1. ≥2 OpenClaw instances run on a single Hostinger VPS via Coolify, each addressable from Nexus per a `user_secrets` row, each isolated by container + bearer + workspace volume.
2. Owner can approve a Board card from a phone via Telegram (or Slack) — round-trip notification → tap → approval recorded → Run advances.
3. Atoms in `memory/molecular/{atoms,entities}` carry `lastAccessed`, `accessCount`, `status` (active/superseded/archived), `supersededBy`. Decay-aware MOC summary regeneration drops cold facts (>30d unaccessed) from the headline section but keeps them queryable.
4. Vector search over molecular atoms returns top-k by semantic similarity in <300ms p95 (Supabase pgvector, `BAAI/bge-small-en` 384-d embeddings, generated by a free local model at write time).
5. Daily notes layer (`memory/daily/YYYY-MM-DD.md`) populated nightly by an extraction cron that scans the day's `run_events` + `audit_log` and writes a timeline + decisions + extracted facts.
6. Sentry → autonomous fix pipeline produces a draft PR for `null-check` / `missing-import` / `type-mismatch` errors in <5 min, passes tests, lands as a Board Review card with the diff viewer pre-loaded.
7. PDF storefront live: a "PDF Business" run template that takes idea → outline → draft → review → cover → landing page → Stripe checkout → publish. End-to-end demo: idea card → first paying customer with Nexus driving every step except final approval clicks.

**Hard constraints**:
- Stack rules per `AGENTS.md` / `memory/platform/STACK.md`. No `pages/` directory, no `tailwind.config.js`, all shared types in `lib/types.ts`.
- Cloud-only deployment. No requirement for a Mac/Linux at home. The owner's only local dependency is the browser + Telegram app.
- Total recurring cloud cost ceiling for the OpenClaw fleet: **$50/mo** (Hostinger VPS + Cloudflare Tunnel free + Anthropic API as variable).
- All cross-instance traffic over Cloudflare Tunnel + bearer auth. OpenClaw gateway binds to loopback only inside each container.
- Per-business OpenClaw bearer + gateway URL stored encrypted in `user_secrets` (B10 already shipped).
- All inbound webhooks (Sentry, Stripe, Telegram) hit Nexus first → HMAC verify → forward to the right OpenClaw via authenticated dispatch.
- No new managed agent unless it replaces an existing one. Keep the agent count tight.
- Approval gates stay at the Board. The Telegram channel is a **mirror** of the Board approval queue — same source of truth, second surface.
- No auto-merge to `main`. Sentry-fix pipeline targets `staging`; human approves merge to `main`.
- Every new env var written to `memory/platform/SECRETS.md` in the same commit that introduces it.

## Phase 1 — Explore (findings)

### Felixcraft architecture summary (from the PDF)

1. **OpenClaw gateway**: routes one or more AI models to messaging surfaces, persistent memory, extensible tools, cron jobs, sub-agent spawning.
2. **Identity files**: `SOUL.md` (voice + boundaries) + `IDENTITY.md` (name + role).
3. **3-layer memory**: `MEMORY.md` (tacit knowledge) + `memory/YYYY-MM-DD.md` (daily notes) + `~/life/` PARA knowledge graph (entities with `summary.md` + `items.json`).
4. **Atomic-fact schema with decay**: each fact has `id`, `fact`, `category`, `timestamp`, `lastAccessed`, `accessCount`, `status` (active|superseded), `supersededBy`. Hot/warm/cold tiers — cold facts drop out of `summary.md` but stay in `items.json`.
5. **QMD vector backend**: reindexes every 5 min, semantic search across all memory layers.
6. **Tools**: file system, web, shell, email (Himalaya CLI), calendar, GitHub, browser automation, sub-agent spawning.
7. **ClawHub**: community skill registry (`npx clawhub@latest install <skill>`).
8. **Trust ladder**: Read-only → Draft & Approve → Act-Within-Bounds → Full Autonomy. Approval queue in a dedicated channel (Telegram topic).
9. **Email security hard rules**: never trust email as a command channel; flag to verified channel and wait for confirmation.
10. **Coding agents at scale**: Ralph loops (many short sessions), PRD checklist validation, two-model split (Opus plan / Codex execute), TDD prompts, parallel execution via git worktrees, tmux + heartbeat health checks, wake hooks for instant completion notification.
11. **Sentry pipeline**: alert → triage (auto-fix vs escalate) → Codex worktree → PR to staging → wake event → human review.
12. **Multi-agent**: each agent has own workspace + identity + model; `agentToAgent: true` lets the primary delegate to specialists.
13. **Webhook hooks**: incoming POST → transform script → AI message (Sentry, Stripe, GitHub).
14. **Cloudflare Tunnel** for remote ingress; gateway binds loopback only.
15. **OpenAI-compatible chat completions endpoint** so other tools can talk to a fully-configured AI through a standard API.
16. **Cost optimization** by model tiering: Haiku for heartbeats, Sonnet for extraction/synthesis, Opus only for primary interactive.
17. **Nightly extraction cron** (11pm): review the day's conversations, extract durable facts, save to entities, update daily note, bump access counts.

### Parity matrix — Nexus vs Felixcraft

| Felixcraft component | Nexus equivalent | Status | Action |
|---|---|---|---|
| OpenClaw gateway | `/api/claw/*` + `/api/claude-session/dispatch` (B10 encrypted bearer) | ✅ | — |
| `SOUL.md` + `IDENTITY.md` | `.claude/agents/<slug>.md` frontmatter (name, description, tools) + `AGENTS.md` (operator preferences) | ✅ Adequate | Document parity in agent generator |
| 3-layer memory | CLAUDE.md formalises Layer 1/2/3 (already credits Felixcraft) | ✅ Superior in structure | — |
| `MEMORY.md` tacit knowledge | `CLAUDE.md` + `AGENTS.md` (operator rules) | ✅ | — |
| Daily notes (`YYYY-MM-DD.md`) | `memory/runs/<run-id>.md` (per-run, not per-day) | ❌ **Gap** | Add `memory/daily/` layer + nightly extraction cron |
| PARA knowledge graph (`~/life/`) | `memory/molecular/` (atoms, entities, MOCs, sources, synthesis) with `[[wikilinks]]` | ✅ Superior — denser graph | — |
| Atomic-fact decay (hot/warm/cold + supersession) | Atom frontmatter has only `type/title/id/created/sources/links` | ❌ **Gap** | Extend atom frontmatter + write decay sweeper |
| QMD vector search | Keyword search via `cli.mjs query` | ❌ **Gap** | Add pgvector embeddings table + retrieval API |
| 5-min reindex cadence | C8 nightly graph rebuild | 🔧 Slower | Optional — daily is fine for a single operator |
| File / web / shell tools | Full Bash/Read/Edit/Write/Grep/WebSearch in agents | ✅ Superior — typed tools | — |
| Email tools (Himalaya CLI) | Resend (outbound only); no inbound parsing | 🔧 Partial | Out of scope for this plan |
| Calendar | None | ❌ Gap | Out of scope (defer) |
| GitHub | `mcp__github__*` MCP server | ✅ | — |
| Browser automation | OpenClaw via Claude Code dispatch | ✅ | — |
| Sub-agent spawning | `Task()` typed agents + n8n strategist swarm flag | ✅ Superior — typed delegation | — |
| ClawHub skill registry | Internal `library` table + `/tools/library` (private) | 🔧 Local-only | Out of scope (no public skills marketplace) |
| Trust ladder + approval queue | Board Review column + diff viewer (A12) | ✅ Superior — visible UI | — |
| Approval queue notification (mobile) | None — must open the dashboard | ❌ **Gap** | Add Telegram (or Slack) bot mirror |
| Email security hard rules | Not yet (no email tools) | N/A | Defer with email scope |
| Ralph loop (PRD-checklist validation) | `/api/claude-session/dispatch` is per-call isolated; no loop wrapper | 🔧 Partial | Add a thin Ralph wrapper for the Sentry-fix pipeline |
| Two-model split (plan / execute) | Documented in STACK.md (Opus / Sonnet / Haiku) | ✅ | — |
| TDD prompts | CLAUDE.md PDCA RED→GREEN→REFACTOR | ✅ | — |
| Parallel agents via git worktrees | Mentioned in CLAUDE.md long-horizon protocol | ✅ | — |
| tmux + heartbeat | None — Vercel serverless model; Inngest cron + Upstash for state | 🔧 Different shape | OpenClaw fleet on Hostinger gets tmux; Vercel side stays serverless |
| Wake hooks (completion notify) | Inngest events + `/api/webhooks/claw` | ✅ Equivalent | — |
| Sentry → autonomous fix pipeline | Sentry not wired (Phase 3 pending); error-paste mode pending (Phase 19b) | ❌ **Gap** | Wire it end-to-end — combines Phase 3 + 19b |
| Multi-agent (`agentToAgent`) | Swarm Queen delegating to specialists | ✅ Superior — Queen pattern | — |
| Webhook hooks + transforms | `/api/webhooks/{stripe,claw,n8n}` HMAC-verified | ✅ | Add `/api/webhooks/sentry` + `/api/webhooks/telegram` |
| Cloudflare Tunnel | Vercel handles inbound for the dashboard | ✅ for dashboard | Add for the OpenClaw fleet only |
| OpenAI-compatible chat endpoint | None | ❌ Gap | Out of scope (defer; not on critical path for PDF business) |
| Cost optimization (model tiering) | STACK.md tiering + per-user daily $25 cap (B9) hard 402 | ✅ Superior — hard cap, not just alert | — |
| Nightly extraction cron | C8 graph rebuild + C2 regression sweep | 🔧 Partial | Add daily-notes extractor cron |
| Messaging surface (Telegram/Slack/Discord) | None | ❌ **Gap** | Add Telegram bot first (single user, simplest) |
| Run state machine | `runs` + `run_events` + 9 phases (A1–A11) | ✅ **Superior** — Felixcraft has none | — |
| Per-user cost cap (hard block) | B9 cost-guard returns HTTP 402 | ✅ **Superior** | — |
| A/B experiment harness | C5 `experiments` + z-test winner | ✅ **Superior** | — |
| ReasoningBank feedforward | A8 `plan_patterns` table + Queen.ts | ✅ **Superior** | — |
| Adaptive routing with decay | C6 Router 14-day half-life | ✅ **Superior** | — |
| Graph-keyed retrieval w/ token budget | A7 GraphRetriever + 12k cap | ✅ **Superior** | — |
| Workflow optimizer feedback loop | ReviewModal feedback → `workflow_feedback` → minimal diff to spec | ✅ **Superior** | — |
| 3D visual knowledge graph | `/graph` Three.js scene, force-directed + clusters | ✅ **Superior** | — |
| Library auto-promotion on success | C4 `lib/library/promoter.ts` | ✅ **Superior** | — |
| Idea Forge → Run → Board pipeline | Productized — Felixcraft has nothing equivalent | ✅ **Superior** | — |

### Net assessment

**Nexus is already structurally ahead of Felixcraft on**:
- Run state machine + observability (A1, A11, C1, C2)
- Self-optimisation harness (A9, C5, C6, C8)
- Approval UI (Kanban + diff viewer)
- Token efficiency (A7, C3, C7)
- Security depth (B1–B10)

**Felixcraft adds value where Nexus has no analogue**:
1. **Multi-OpenClaw fleet** — one operator can run N business AIs in parallel with isolated identity/memory/tools.
2. **Mobile messaging surface** — approve/triage from a phone outside the dashboard.
3. **Atomic-fact decay model** — molecular memory currently grows monotonically; needs hot/warm/cold + supersession.
4. **Vector search** — keyword `cli.mjs query` misses semantic matches.
5. **Daily notes layer** — chronological "what happened today" complements per-run snapshots.
6. **Autonomous Sentry→fix pipeline** — combines Phase 3 (Sentry) + Phase 19b (error-paste mode) into a single closed loop.
7. **Ralph-style PRD-checklist loop** — useful only for the Sentry-fix pipeline; the rest of Nexus's flow doesn't need it.

## Phase 2 — Plan (atomic tasks)

Three new pillars layered on top of the existing A/B/C work:

- **Pillar D — Multi-OpenClaw cloud fleet** (Hostinger Coolify; the substrate that makes per-business AIs possible)
- **Pillar E — Felixcraft-derived feature parity** (decay, daily notes, vector search, messaging surface, Sentry→fix pipeline)
- **Pillar F — PDF Storefront business** (productized run template using D + E)

Task IDs: `D#`, `E#`, `F#`. Each task is 2–5 min of implementation. `Parallel: yes` tasks safe to dispatch concurrently.

### Pillar D — Multi-OpenClaw cloud fleet

**Hosting decision (open question for owner — see Risks)**:

| Option | $/mo | Pros | Cons |
|---|---|---|---|
| **Hostinger KVM 4** + Coolify (recommended) | ~$8–10 | Cheapest; matches roadmap Phase 21d (Coolify); single VPS hosts N containers; Cloudflare Tunnel free | Single host = single point of failure; you maintain the OS |
| Fly.io per-app | ~$5/instance + bandwidth | Multi-region, persistent volumes, instant TLS, separate billing per business | Costs grow linearly; cold-start latency on shared 1x |
| Railway | $5 base + usage | One-click deploys, GitHub integration | Pricing creeps with usage |
| Render | $7+ per service | Reliable, managed certs | Pricier than Hostinger for the same compute |
| Cloudflare Containers (beta) | TBD | Native Tunnel + Workers integration; future-proof | Beta — production risk |

**Recommendation**: Start with Hostinger KVM 4 + Coolify (matches Phase 21d in roadmap, single $10/mo VPS). Migrate the busiest business to Fly.io when it outgrows the shared host.

#### D1 — Provision Hostinger KVM 4 + Coolify
- File: none (infra)
- Change: provision a Hostinger KVM 4 (4GB / 2 vCPU / 80GB SSD), install Coolify v4 (`curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`), point a subdomain `coolify.<your-domain>` at it.
- Verify: Coolify dashboard reachable; SSH key-only auth; `ufw` default-deny inbound except 22/80/443.
- Parallel: no (one-shot infra step). **Owner-gated** — requires a Hostinger account + payment method.

#### D2 — Cloudflare Tunnel ingress
- File: none (infra)
- Change: create a Cloudflare Tunnel `nexus-claw-fleet`; route `*.claw.<your-domain>` → the Coolify host's internal Docker network. Each OpenClaw container exposes its gateway on a unique loopback port; the tunnel maps `<biz-slug>.claw.<your-domain>` → `localhost:<port>`.
- Verify: `dig <biz-slug>.claw.<your-domain>` returns a Cloudflare IP; HTTPS hits Coolify with cert.
- Parallel: depends on D1.

#### D3 — Base OpenClaw container image
- File: `docker/openclaw/Dockerfile` (new) + `docker/openclaw/entrypoint.sh` (new)
- Change: based on `node:22-bookworm-slim`. Install OpenClaw CLI, tmux, jq, curl. Entry point: read `WORKSPACE_DIR` env, mount `/workspace` volume, run `openclaw start --bind=loopback --port=18789`. Healthcheck: `curl http://127.0.0.1:18789/health`.
- Verify: `docker build` succeeds; `docker run -p 18789:18789` returns 200 on `/health`.
- Parallel: yes.

#### D4 — Per-business workspace template
- File: `docker/openclaw/workspace-template/{SOUL.md,IDENTITY.md,MEMORY.md,AGENTS.md}` (new)
- Change: skeleton workspace files mirroring the Felixcraft templates from the PDF (Chapter 12). Placeholders for `{{BUSINESS_NAME}}`, `{{BUSINESS_ROLE}}`, `{{BUSINESS_BOUNDARIES}}` filled at provisioning time by a small `envsubst` step in the entrypoint.
- Verify: rendered output has no remaining `{{...}}` placeholders.
- Parallel: yes.

#### D5 — Coolify "deploy a business" template
- File: `docker/openclaw/coolify.yaml` (new — Compose-style)
- Change: declares the OpenClaw service, named volume `<biz-slug>-workspace`, env vars (`BUSINESS_NAME`, `BUSINESS_ROLE`, `ANTHROPIC_API_KEY`, `OPENCLAW_BEARER_TOKEN`, `WORKSPACE_DIR=/workspace`), Cloudflare Tunnel hostname mapping. New business = new Coolify app from this template (one click).
- Verify: spinning up two apps from the template produces two reachable gateway URLs with different bearers.
- Parallel: depends on D3, D4.

#### D6 — Nexus-side: per-business `user_secrets` row schema
- File: `lib/types.ts` (edit) + `supabase/migrations/019_business_secrets.sql` (new)
- Change: add `business_secrets` table (`user_id, business_slug, gateway_url, bearer_token_encrypted, model_alias, created_at`). RLS scopes to `user_id`. Encryption via existing `lib/crypto.ts` (AES-GCM, B6).
- Verify: insert + select round-trip preserves the bearer; cross-user select returns 0 rows.
- Parallel: yes.

#### D7 — Per-business OpenClaw client
- File: `lib/claw/business-client.ts` (new)
- Change: factory `getClawClient(userId, businessSlug)` decrypts the bearer for that business and returns a thin wrapper around `fetch(gatewayUrl, { headers: { Authorization: `Bearer ${bearer}` } })`. Falls back to the legacy single-tenant client when no `business_slug` is supplied.
- Verify: unit test mocks the secret store, asserts the right gateway is hit.
- Parallel: depends on D6.

#### D8 — `/api/claude-session/dispatch` accepts `businessSlug`
- File: `app/api/claude-session/dispatch/route.ts` (edit)
- Change: optional `businessSlug` field on the request body; route through `getClawClient(userId, businessSlug)` when set. `runId` linkage continues to work — runs already cross businesses.
- Verify: dispatch with `businessSlug='pdf-store'` lands in the pdf-store container's logs; without it, falls back to the user's default OpenClaw config.
- Parallel: depends on D7.

#### D9 — Business switcher UI in `/tools/claw`
- File: `app/(protected)/tools/claw/page.tsx` (edit) + `components/tools/BusinessSwitcher.tsx` (new)
- Change: list of business AIs with status (online / last-dispatch / token-spend-today). "Add a business" CTA opens a wizard that POSTs to `/api/claw/business` and provisions a Coolify app via Coolify's API.
- Verify: creating a new business through the UI ends up with a row in `business_secrets` + a Coolify app + a reachable gateway URL.
- Parallel: depends on D5, D6.

#### D10 — Cost cap per business (extends B9)
- File: `lib/cost-guard.ts` (edit)
- Change: composite key `(userId, businessSlug)` instead of `userId` alone for the daily cap. Default $10/business/day; user-level cap (B9 default $25) still applies as ceiling.
- Verify: a single business hitting $10 returns 402 even when total user spend is below $25.
- Parallel: depends on D6.

### Pillar E — Felixcraft-derived feature parity

#### E1 — Atom frontmatter: decay fields
- File: `.claude/skills/molecularmemory_local/cli.mjs` (edit) + every existing atom file (one-time migration)
- Change: extend the atom YAML schema with `lastAccessed: <ISO date>`, `accessCount: 0`, `status: active`, optional `supersededBy: <slug>`. CLI `atom` command writes defaults; new `cli.mjs touch <slug>` bumps `lastAccessed` + `accessCount`. New `cli.mjs supersede <oldSlug> <newSlug>` flips status + adds backlink.
- Verify: `cli.mjs query "X"` returns hits ordered by `accessCount` desc; `cli.mjs lint` warns on `status: active` atoms with `lastAccessed` >90d (cold-fact candidates).
- Parallel: yes.

#### E2 — Decay-aware MOC summary regeneration
- File: `.claude/skills/molecularmemory_local/cli.mjs` (edit, `reindex` command)
- Change: when regenerating each MOC's body, group atoms by tier — Hot (`lastAccessed` <7d) at the top, Warm (8–30d) in the middle, Cold (>30d) collapsed under a `<details>` block. Superseded atoms hidden by default.
- Verify: re-run `reindex` after a fresh `touch` on 3 atoms; those 3 now appear in the Hot section.
- Parallel: depends on E1.

#### E3 — Bump `accessCount` when an atom is read by an agent
- File: `lib/molecular/access-tracker.ts` (new) + `lib/swarm/GraphRetriever.ts` (edit, A7)
- Change: every time `GraphRetriever` includes an atom in the prompt, fire-and-forget POST to `/api/molecular/touch` with the atom slug. Server runs `cli.mjs touch <slug>` (debounced 1×/min/atom).
- Verify: an atom referenced in a swarm run shows `accessCount` increment + fresh `lastAccessed` after the run.
- Parallel: depends on E1.

#### E4 — pgvector embeddings for semantic search
- File: `supabase/migrations/020_atom_embeddings.sql` (new) + `lib/molecular/embed.ts` (new) + `app/api/molecular/search/route.ts` (new)
- Change: enable `vector` extension; table `atom_embeddings(atom_slug primary key, embedding vector(384), updated_at)`. Embeddings generated by `BAAI/bge-small-en` via `transformers.js` (free, runs in Node) at write time. `/api/molecular/search?q=...&k=10` returns top-k by cosine similarity, falls back to keyword `cli.mjs query` when pgvector unavailable.
- Verify: query "agent generation protocol" returns the existing atom-on-protocol with cosine ≥ 0.7.
- Parallel: yes.

#### E5 — Hybrid retrieval in GraphRetriever
- File: `lib/swarm/GraphRetriever.ts` (edit)
- Change: prefer pgvector top-k; fall back to keyword + graph traversal when pgvector returns <3 hits. Token-budget cap stays 12k.
- Verify: A/B same swarm goal under both retrievers; semantic version surfaces an atom keyword retrieval misses.
- Parallel: depends on E4.

#### E6 — Daily notes layer
- File: `memory/daily/.gitkeep` (new) + `lib/runs/daily-extractor.ts` (new) + `app/api/cron/daily-extract/route.ts` (new)
- Change: nightly at 23:00 (operator-local TZ): scan `run_events`, `audit_log`, and the day's `workflow_feedback` rows. Generate `memory/daily/YYYY-MM-DD.md` with sections: Key Events (timestamped), Decisions, Facts Extracted (with auto-promotion suggestions), Active Long-Running Processes (any unfinished runs). Commit to the repo via the same low-priv PAT used by C8.
- Verify: trigger manually → file appears, all sections populated; rerun is idempotent (overwrites same day).
- Parallel: yes.

#### E7 — Telegram messaging surface (single-user)
- File: `lib/telegram/client.ts` (new) + `app/api/webhooks/telegram/route.ts` (new) + `app/api/telegram/notify/route.ts` (new)
- Change: Telegram bot via `node-telegram-bot-api` (or raw fetch — keep it lean). Webhook receives messages → HMAC-equivalent: verify `secret_token` header set at `setWebhook` time. Inbound `/approve <runId>` and `/reject <runId> <reason>` commands map to `advancePhase`. `/api/telegram/notify` posts a card notification to the operator's chat with inline buttons "Approve / Reject / Open in Nexus" linking to `/board?runId=...`.
- Verify: send `/approve <runId>` from the operator's phone → Run advances; reject path works; notify endpoint sends a card with buttons.
- Parallel: yes.

#### E8 — Mirror Board approval queue to Telegram
- File: `lib/board/approval-queue.ts` (new wrapper) + `components/board/ReviewModal.tsx` (edit)
- Change: when a card lands in the Review column (or `phase=review`), `approval-queue.ts` calls `/api/telegram/notify` once. When the human approves on Telegram OR on the dashboard, the other surface updates via Supabase Realtime. Single source of truth = `runs.phase`.
- Verify: card lands → phone gets notification; approve from phone → dashboard updates instantly.
- Parallel: depends on E7.

#### E9 — `/api/webhooks/sentry` receiver
- File: `app/api/webhooks/sentry/route.ts` (new) + `lib/sentry/triage.ts` (new)
- Change: HMAC-verify Sentry's `Sentry-Hook-Signature` header. Triage rules from PDF Chapter 9: green-light auto-fix on null-checks / missing imports / type mismatches; red-light escalate on architecture / security / migrations. Green-light path enqueues a build run with `phase=build, kind=sentry-fix, errorId=<sentry id>`.
- Verify: replay a sample Sentry payload → row appears in `runs` with the right kind; non-matching payload returns 400.
- Parallel: depends on Phase 3 Sentry install (currently pending). **Pre-requisite** — owner installs `@sentry/nextjs` + sets `SENTRY_DSN`.

#### E10 — Ralph-style fix loop for Sentry runs
- File: `lib/runs/ralph-fix.ts` (new) + `app/api/cron/ralph-tick/route.ts` (new)
- Change: per Sentry-fix run, generate a PRD checklist (`Write failing test for <error>`, `Fix in <file>`, `Run tests`, `Open PR to staging`). Dispatch via `/api/claude-session/dispatch` with `businessSlug='nexus-self'` (the platform's own AI). Cron tick every 60s checks PRD completion: all boxes ticked → mark run `phase=review` and notify; stalled (no progress in 5 min) → kill + relaunch up to 3 times; failed 3× → escalate to human via Telegram.
- Verify: synthetic Sentry payload → branch + tests + PR appear within 5 min on staging; PRD checkboxes all ticked; Board card shows the diff via the existing DiffViewer (A12).
- Parallel: depends on E9, A6, A12.

#### E11 — Wake hooks for instant completion
- File: `app/api/claude-session/dispatch/route.ts` (edit) + `lib/notify/wake.ts` (new)
- Change: on dispatch completion, fire `wake(runId, summary)` which (1) writes a `run_events` row, (2) calls `/api/telegram/notify` if the run had `notifyOnDone=true` set at dispatch time. Felixcraft-style "knows the moment work is done."
- Verify: dispatch with `notifyOnDone=true` → Telegram chime within 3s of completion.
- Parallel: depends on E7.

### Pillar F — PDF storefront business (the first product)

The "PDF business" is a Nexus run template that walks idea → outline → manuscript → cover → landing page → Stripe checkout → publish + distribute. It uses Pillar D for the per-business AI ("the author") and Pillar E for messaging-driven approvals. The result is a productized version of what Felix did to ship "How to Hire an AI."

#### F1 — `pdf-business` run template
- File: `lib/runs/templates/pdf-business.ts` (new) + `lib/types.ts` (edit — add `RunTemplate` interface)
- Change: declarative template with phases `ideate → outline → draft → review → cover → landing → checkout → launch → measure → optimise → done`. Each phase has: spec prompt, expected outputs, `requireApproval: bool`, `assignedTo: businessSlug`. Template is consumed by `startRun({templateId: 'pdf-business', ...})`.
- Verify: starting a run with this template lands `phase=ideate`; `advancePhase` walks through each step.
- Parallel: depends on existing A1–A4.

#### F2 — Provision the "Felix" business AI
- File: none (Coolify app from the D5 template)
- Change: spin up an OpenClaw container `felix.claw.<your-domain>` with `BUSINESS_NAME=Felix`, `BUSINESS_ROLE=PDF Author + Storefront Operator`, custom `SOUL.md` derived from PDF Chapter 3 templates (intellectually sharp + warm, takes positions, never sycophantic). Add the bearer to `business_secrets` row.
- Verify: `/api/claude-session/dispatch { businessSlug: 'felix', message: 'who are you?' }` returns Felix-flavoured reply.
- Parallel: depends on D5, D6.

#### F3 — Outline → draft pipeline using Tribe v2
- File: `lib/runs/templates/pdf-business.ts` (edit) — fill in `outline` and `draft` phase prompts
- Change: `outline` calls `/api/content/generate` with neuro-content settings (long-form, authoritative tone) producing a chapter-by-chapter MD outline. `draft` runs N parallel `/api/claude-session/dispatch` calls (one per chapter) to a `businessSlug='felix'` instance, each with an isolated git worktree. Each chapter is a Board card; reviewer approves chapters individually before they merge into a `manuscript.md`.
- Verify: a 5-chapter book completes draft in <30 min wall-clock; each chapter card has a diff + approve/reject; merged manuscript exists at `runs/<runId>/manuscript.md`.
- Parallel: depends on F1, F2.

#### F4 — Cover image generation
- File: `lib/runs/templates/pdf-business.ts` (edit, `cover` phase)
- Change: dispatch a `muapi.ai` (Phase 12 follow-up) or DALL-E request with the brief from `outline`. Output stored in R2 (B3-guarded) under `<userId>/<runId>/cover.png`. Board card preview = the image.
- Verify: card shows generated image; manual reject regenerates.
- Parallel: depends on F3.

#### F5 — Landing page generator
- File: `app/(public)/p/[slug]/page.tsx` (new — public sales page route under a non-protected segment) + `lib/landing/generator.ts` (new)
- Change: a new public route group `app/(public)/` (sibling to `(protected)`) bypassing the `proxy.ts` allowlist for `/p/*` paths only. Generator builds a one-pager from `manuscript.md` headline + cover + Stripe Checkout CTA. Owner can edit copy at `/tools/pdf-store`.
- Verify: navigating to `/p/<slug>` unauthed returns 200 with the page; Lighthouse perf ≥ 90.
- Parallel: depends on F4.

#### F6 — Stripe Checkout + license issuance
- File: `app/api/stripe/checkout/route.ts` (new) + `app/api/webhooks/stripe/route.ts` (edit — already exists)
- Change: `POST /api/stripe/checkout { runId }` creates a Stripe Checkout session for the PDF price; success webhook fires → record `purchases` row → email customer a signed download URL (R2 short-lived presigned URL) via Resend.
- Verify: end-to-end Stripe test card → email arrives with working download link; URL expires in 24h.
- Parallel: depends on F5.

#### F7 — Publish + distribute (close the loop with A10)
- File: `lib/runs/templates/pdf-business.ts` (edit, `launch` phase)
- Change: hit existing `/api/publish` (A10 — YouTube Shorts live) with a 60-second teaser video (Phase 18 Kling/Runway pipeline) + a tweet thread drafted by Felix. Approval-gated via Telegram (E8). On approve → posted; URL recorded back to the run.
- Verify: launch run produces a YouTube Short URL + tweet draft; both gated by Telegram approval.
- Parallel: depends on E8, A10.

#### F8 — Measure → optimise (close the loop with A11/C5)
- File: none (existing A11/C5 cron jobs handle this once F7 records the URLs).
- Change: A11's `ingest-metrics` cron polls views/CTR/conversions for the YouTube Short and the landing page. When sample size hits threshold, C5's experiment harness picks the winning headline/cover variant and queues a `workflow_feedback` row for Felix to learn from.
- Verify: 24h after launch, dashboard shows views + revenue; experiment winner column populated.
- Parallel: depends on F7.

## Task sequencing

```
Owner-gated (block before starting):
  D1 (Hostinger account + payment) ──┐
  E9 prereq (Sentry install)         │
                                     │
Pillar D (multi-OpenClaw fleet):     │
  D1 → D2 → D3,D4 (parallel) → D5    │
       → D6 (parallel) → D7 → D8     │
       → D9, D10 (parallel)          │
                                     │
Pillar E (feature parity):           │
  E1 → E2,E3 (parallel)              │
  E4 → E5 (parallel with E1–E3)      │
  E6 (parallel)                      │
  E7 → E8, E11 (parallel)            │
  E9 → E10 (after Sentry installed)  │
                                     │
Pillar F (PDF business):  ←──────────┘ (depends on D and E being usable)
  F1 → F2 → F3 → F4 → F5 → F6 → F7 → F8
```

### First commit (foundation)
**D1–D5 + E1–E3**: provision the Hostinger fleet base + decay-aware molecular memory. After this, you can spin up OpenClaw containers per business, and atoms decay properly.

### Second commit (vector search + daily notes)
**E4–E6**: pgvector embeddings + daily notes. Now Nexus retrieves semantic matches and accretes a chronological log.

### Third commit (messaging surface)
**E7–E8 + E11**: Telegram approval mirror + wake hooks. Owner can approve from a phone.

### Fourth commit (Sentry → fix pipeline)
**E9 + E10** (after `@sentry/nextjs` installed). Autonomous bug fixing live on staging.

### Fifth commit (multi-business UI + cost cap)
**D6–D10**: per-business cost cap + business switcher UI. Now visible end-to-end as a productized capability.

### Sixth commit (PDF storefront)
**F1–F8**: ship the first commercial product running on top of D + E. Approval-gated, end-to-end, measured.

## Risks

| Risk | Mitigation |
|---|---|
| **Hostinger single-host SPOF** — one VPS dies, all businesses go down | Daily volume snapshot to R2; recovery runbook documented in `docs/runbooks/openclaw-fleet.md`. Migrate the highest-revenue business to Fly.io once revenue >$200/mo. |
| **OpenClaw not officially supported on Linux containers** — PDF mentions Mac OR Linux server but provides Mac LaunchAgent examples only | Validate with a single D3 container before D5; if blocked, fall back to a single OpenClaw-on-host pattern with workspaces as directories under one container. |
| **Anthropic rate limits across multiple OpenClaw instances** | Each business gets its own `ANTHROPIC_API_KEY`. Pre-purchase a higher tier on the busiest one. Track `429s` in observability. |
| **Telegram bot single point of failure for approvals** | Dashboard remains the primary surface; Telegram is a *mirror*. If the bot dies, approvals still work via web. |
| **pgvector embeddings drift across model versions** | Pin `BAAI/bge-small-en` to a specific revision; on upgrade, re-embed all atoms in a single migration. |
| **Decay model deletes hot facts of inactive projects** | Status goes `archived`, not deleted. Cold facts collapse under `<details>` but stay queryable. Never `DELETE FROM atoms`. |
| **Sentry-fix pipeline opens bad PRs** | Hard-coded auto-fix categories (null check / missing import / type mismatch only); anything else escalates. PRs target staging, never `main`. PRD checklist must include `Run full test suite`. |
| **PDF business publishes copyrighted material** | Felix template's `SOUL.md` includes a hard rule: never reproduce passages from sources without explicit citation. Manual review at the `manuscript` stage is mandatory (not skippable). |
| **Stripe Checkout misroutes funds during testing** | Test mode keys in dev; live mode keys only after end-to-end test purchase by owner. |
| **Cloudflare Tunnel + Coolify auth bypass** | Coolify behind Cloudflare Access (Zero Trust free tier, owner email allowlist). Direct port access blocked at `ufw`. |
| **Multi-business cost overrun** | D10 per-business cap + B9 user cap; daily Sentry-style cost report at 9am via Telegram. |
| **Coolify upgrade breaks the fleet** | Pin Coolify version; test upgrades on a staging VPS first. |
| **Felix-AI hallucinates revenue numbers when posting publicly** | PDF Chapter 6 rule: "Never share internal details, revenue numbers, or private conversations publicly" hard-coded into Felix's `SOUL.md`. |

## PDCA gates

| Gate | Check |
|---|---|
| After D1 (infra provisioned) | Coolify dashboard reachable; SSH key-only; `ufw` default-deny; cost so far ≤ $10/mo |
| After D5 (template) | Two parallel businesses spin up from the same template, addressable from Nexus, with isolated bearers |
| After E3 (decay tracking) | After 1 week, `cli.mjs lint` reports correct hot/warm/cold tier counts |
| After E5 (semantic search) | Top-k search returns ≥ 1 atom that keyword search missed on a known query |
| After E8 (Telegram mirror) | Round-trip: Board card → phone notification → tap approve → Run advances < 5s |
| After E10 (Sentry fix) | Synthetic null-pointer error → PR on staging within 5 min, all tests pass, owner only needs to merge |
| After F6 (Stripe wired) | Test purchase → email with working download URL; TOTP-protected admin sees the purchase |
| After F8 (loop closed) | 24h after launch: dashboard shows views, revenue, experiment winner column populated, decay model touched ≥ 5 atoms |
| Before each commit | `npx tsc --noEmit` passes; new env vars in `memory/platform/SECRETS.md`; ROADMAP updated where appropriate |
| Before each new business goes live | Owner signs off in `docs/runbooks/business-<slug>-launch.md` (revenue model, scope, kill-switch documented) |

## Progress (as of 2026-04-26)

### Completed
- [x] Phase 1 — explore + parity matrix (this entry)
- [x] Phase 2 — atomic plan written (this entry)
- [x] PDF ingested at `docs/pdfs/How-to-Hire-an-AI.pdf`; reading harness validated (`pdftotext` + Read tool fallback)
- [x] **E1** — atom decay frontmatter (`status`, `lastAccessed`, `accessCount`, `supersededBy`) in `cli.mjs`. Added `touch`, `supersede`, `migrate-decay` commands. 138 atoms migrated across 4 namespaces (default/roadmap/integration/tasks).
- [x] **D6+D7** — `lib/claw/business-client.ts` resolves OpenClaw config per business via `user_secrets` with `kind='business:<slug>'`. Layered fallback to user default → env vars. No new migration needed (existing `user_secrets` table covers it).
- [x] **D8** — `/api/claude-session/dispatch` accepts `businessSlug` + `notifyOnDone`; routes through `resolveClawConfig`; gates with `assertUnderCostCap`.
- [x] **D10** — `lib/cost-guard.ts` returns `{ ok, spentUsd, capUsd, scope }` with `scope='business'|'user'`. Per-business cap defaults to $10/day via `USER_BUSINESS_DAILY_USD_LIMIT`. Migration `019_token_events_business_slug.sql` adds the column.
- [x] **D3+D4+D5** — `docker/openclaw/{Dockerfile,entrypoint.sh,coolify.yaml,README.md}` + `workspace-template/{SOUL,IDENTITY,MEMORY,AGENTS}.md`. envsubst-templated; renders on first boot; non-root `claw` user; loopback bind; tini PID 1.
- [x] **E6** — `lib/runs/daily-extractor.ts` builds `memory/daily/YYYY-MM-DD.md` from `run_events`/`workflow_changelog`/`workflow_feedback`/active runs. `app/api/cron/daily-extract/route.ts` (owner-only) writes to disk OR returns body when serverless FS is read-only.
- [x] **E7** — `lib/slack/client.ts` (signature verify + Block Kit + incoming-webhook post). `app/api/slack/notify/route.ts` outbound endpoint.
- [x] **E8** — `app/api/webhooks/slack/route.ts` handles `/approve <runId>`, `/reject <runId> <reason>`, `/status <runId>`. Slack-user → Clerk-user mapping via `SLACK_USER_<id>` env or first `ALLOWED_USER_IDS`.
- [x] **E11** — `lib/notify/wake.ts` + dispatch hook fires Slack notification on dispatch completion when `notifyOnDone:true`.

### Remaining
- [ ] **Owner-gated prereqs**: Hostinger KVM 4 + Coolify provisioned (D1, D2); Slack workspace created with incoming-webhook URL + signing secret in Doppler (`NEXUS_SLACK_WEBHOOK_URL`, `NEXUS_SLACK_SIGNING_SECRET`) — `lib/slack/client.ts` falls back to env when `user_secrets` is empty, so single-operator setup is single-tenant Doppler; GlitchTip deployed for Phase 21c (then E9/E10 Sentry pipeline becomes implementable).
- [ ] **D1, D2** — Provision Hostinger VPS + Cloudflare Tunnel (infra; cannot be done from this session). Recommendation: KVM 4 + self-managed Coolify (matches our custom `docker/openclaw/` + `docker/qmd/`). 1-click Claw templates fight the per-business templating.
- [ ] **D9** — Business switcher UI in `/tools/claw` (UI work; defer until at least one business is provisioned so the panel has data to show).
- [ ] **E9 / E10** — Sentry / GlitchTip → autonomous fix pipeline. Gated on Phase 21c (GlitchTip deploy) per owner decision.
- [ ] **F1–F8** — PDF storefront business. Topic now picked (`teaching others how to use AI to automate parts of their business`); awaiting infra (D1/D2) before the run template can dispatch.

### Recently completed (this session)

- [x] **E2** — `cli.mjs reindex` groups atoms by decay tier (Hot / Warm / Cold / Superseded) in `INDEX.md`. Tier algorithm: Hot = ≤14 days + ≥5 accesses; Warm = ≤60 days; Cold = older or no decay metadata; Superseded comes from `status: superseded|archived`. Counts emitted in JSON output.
- [x] **E3** — `lib/molecular/decay.ts` shared `touchAtom` / `touchAtomsByNodeIds` helpers. `app/api/molecular/touch/route.ts` (POST, owner-gated, rate-limited). `lib/swarm/GraphRetriever.ts` fires-and-forgets touch on retrieved `memory_atom` IDs.
- [x] **E4** — `docker/qmd/` — Dockerfile + entrypoint + Coolify Compose + README. Bundles tobi/qmd via npm global, clones the repo at boot, runs `qmd update + embed`, exposes MCP HTTP on 8181. Auth handled by Cloudflare Tunnel + Access. `lib/molecular/qmd-client.ts` is a JSON-RPC `tools/call` client that no-ops when `QMD_ENABLED` is unset.
- [x] **E5** — `lib/molecular/hybrid.ts` `hybridSearch(query)` runs graph + QMD legs in parallel, fuses with Reciprocal Rank Fusion (k=60), auto-touches matched atoms (delegates to E3). `app/api/molecular/search/route.ts` exposes POST + GET (health). Falls back to graph-only when QMD is unreachable.

### Blockers / Open Questions
1. **Hostinger vs alternatives** — recommendation is Hostinger KVM 4 + Coolify ($8–10/mo) for cost + alignment with Phase 21d, but the owner may prefer Fly.io for separate billing per business. Pick before D1.
2. **Single Anthropic key vs per-business keys** — per-business is cleaner but multiplies billing surface. Recommend single key for now; split when one business hits 80% of monthly spend.
3. **Telegram vs Slack** — Telegram is simpler and matches the PDF; Slack integrates better if Phase 21 OSS-stack ever needs it. Recommend Telegram first; Slack can be added later as a second mirror without breaking E8.
4. **PDF business topic** — owner picks the first PDF subject. Recommend "How to ship a PDF business with Nexus" (meta, mirrors Felix's playbook, gives the platform a reference customer). Alternative: a domain the owner already has expertise in (drives credibility).
5. **Public route group `(public)`** — F5 introduces public marketing pages; verify `proxy.ts` doesn't accidentally block them. May need a small middleware tweak.
6. **Sentry vs GlitchTip** — Phase 21c roadmap targets GlitchTip (OSS, Sentry-compatible). E9/E10 should target the Sentry HTTP API; switching to GlitchTip later is a config swap, not a rewrite.
7. **OpenClaw "browser automation"** — needs Playwright in the container. D3 image must include it (~+200 MB) or D3 stays slim and we add a `D3a` variant for businesses needing browser tools.

