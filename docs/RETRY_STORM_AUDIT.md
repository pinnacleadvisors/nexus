# Nexus — Retry Storm Audit

> Living document. **Re-run the audit every time a new external integration is added** or after any incident with abnormal request volume. Findings are filled in by the [Explore-agent audit](#audit-procedure) at the bottom — re-run that any time.

## What a retry storm looks like

A single transient failure cascades into a flood of retries that hammer paid services or our DB. The 2026-05-03 incident burned **$100 in Vercel credits + 14.49 GB Supabase egress** in a few hours. Anatomy:

```
1. One thing breaks — usually a missing migration, rotated key, or
   schema mismatch.
2. Our route returns 5xx instead of degrading gracefully.
3. The upstream caller (n8n, OpenClaw gateway, Stripe, Slack) auto-retries.
   Default policies: n8n=3 attempts with backoff, claw gateway=5,
   Stripe=until 4xx for up to 3 days, Slack=rare.
4. Each retry hits Vercel → which calls Supabase → which fails the same way.
5. PostgREST connection pool exhausts, function instances pile up, paid
   tokens get burned, egress spikes.
6. We can't even fix the root cause because the fix tools (`npm run migrate`,
   Supabase Studio) share the same overloaded infrastructure.
```

The defining feature: **failure begets more requests**, instead of fewer.

## Universal mitigations

Every external surface (webhook, cron, frontend fetch, outbound API) MUST follow at least one of these patterns. The right pick depends on the surface.

| Pattern | When to use | Reference impl |
|---|---|---|
| **Fail-soft insert** — detect the error class, cache, retry without the offending fields | Schema-mismatch / column-doesn't-exist | `lib/board/insert-task.ts` |
| **Auth-cache** — first auth-class failure flips a process-local switch, subsequent calls skip silently | Stale credentials (R2, Slack, etc.) | `app/api/vercel/log-drain/route.ts` r2DisabledReason |
| **Always-200 envelope** — return 200 + `{ ok: false, error }` instead of 5xx so upstream doesn't retry | Webhook handlers where the caller will retry on 5xx | `app/api/webhooks/n8n/route.ts` after `644c067` |
| **Idempotency key** — dedupe by upstream-provided ID within a sliding window | Webhooks delivering the same event multiple times | (planned for n8n: `executionId` |
| **Circuit breaker** — N failures in M minutes → pause for cooldown | Outbound calls to expensive APIs | (planned: `lib/health/circuit-breaker.ts`) |
| **Exponential backoff with cap** | Outbound retries we DO want | `scripts/migrate.mjs` |
| **Kill switch env var** | Incident response | (planned: `NEXUS_KILL_SWITCH`) |

## Severity scale

- **HIGH** — auto-retry mechanism upstream + cost amplification on each retry. Fix immediately; this is how you blow $100 in an hour.
- **MEDIUM** — cron / scheduled re-fire could compound. Fix in the next cleanup pass.
- **LOW** — manually triggered, single-shot, or already idempotent. Document and move on.

## Findings

> Generated 2026-05-03 by the Explore-agent audit (see [Audit procedure](#audit-procedure)). Re-generate after every external-integration addition.

### Summary (2026-05-03 pass)

| Category | Findings | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| Webhooks | 4 | 0 | 3 | 1 |
| Inngest | 4 | 0 | 3 | 1 |
| Cron | 8 | 1 | 2 | 5 |
| Frontend | 3 | 0 | 2 | 1 |
| Outbound APIs | 5 | 0 | 5 | 0 |
| DB writers | 2 | 0 | 1 | 1 |
| **Total** | **26** | **1** | **16** | **9** |

Top three follow-ups (in order):

1. **HIGH** — `/api/cron/signal-review` loop has no per-signal try/catch; one bad signal fails the cron, Vercel re-fires next schedule, processes the bad signal again
2. **MEDIUM** — `/api/webhooks/claw` lacks idempotency; replayed webhook = duplicate cards
3. **MEDIUM** — frontend pollers (`/tools/claw/status`, `/dashboard/org`) hit 5xx endpoints at 8s/15s cadence with no backoff

### 1. Webhook handlers under `app/api/webhooks/`

| Route | Severity | Issue | Mitigation |
|---|---|---|---|
| `/api/webhooks/n8n` | **MEDIUM** | n8n auto-retries 5xx 5×. `insertTask` already mitigates the column-mismatch class. Signature failures still 401 → n8n no-retries 4xx, OK. | Add explicit rate-limit headers; document in route header comment |
| `/api/webhooks/claw` | **MEDIUM** | Fire-and-forget `insertTask()` — claw retries 5× on 5xx. Currently returns 200 quickly, so this is OK. But no idempotency: a replayed event creates duplicate cards. | Add UNIQUE constraint or pre-insert existence check on `(claw_event_id, user_id)`; stamp event ID on the row |
| `/api/webhooks/stripe` | **MEDIUM** | Stripe retries until 4xx, for up to 3 days. Revenue events inserted without dedup → replays = duplicate revenue rows. | Add `UNIQUE(stripe_event_id)` on `revenue_events`; ON CONFLICT DO NOTHING |
| `/api/webhooks/slack` | **LOW** | Slash commands rarely retry; `advancePhase` / `setStatus` are phase-aware (won't double-advance). | None needed |

### 2. Inngest functions under `inngest/functions/`

Inngest retries failed steps 3× by default. Each retry re-runs the entire function from the failed step, so any paid call before that step gets re-charged.

| Function | Severity | Issue | Mitigation |
|---|---|---|---|
| `inngest/functions/research-loop.ts` | **MEDIUM** | Calls Tavily (paid per query) + Anthropic (gateway / API key) inside a single function. On any throw, Inngest retries 3× → 3× Tavily quota burn + 3× LLM tokens. | Wrap Tavily/Anthropic in `step.run('search', { maxRetries: 0 }, ...)`; surface failures to the digest output instead of throwing |
| `inngest/functions/business-operator.ts` | **MEDIUM** | Gateway plan synthesis on every business. Flaky gateway → 3× Inngest retry → 3× Max-plan token burn. | Add circuit-breaker to `isGatewayHealthy()`; skip retry when health check already failed in last 5 min |
| `inngest/functions/ingest-metrics.ts` | **MEDIUM** | YouTube / TikTok / Instagram polling per measuring run. Provider timeout → throw → 3× retry → 3× quota. YouTube quota especially limited. | `.catch(() => null)` per provider; log failure for manual review instead of throwing |
| `metric-optimiser.ts`, `regression-detector.ts` | **LOW** | Local-only operations, no paid calls per retry. | None needed |

### 3. Vercel cron routes under `app/api/cron/`

Vercel itself doesn't retry crons, but a failing cron re-fires on its next schedule slot. If the failure is non-idempotent, side-effects accumulate.

| Route | Severity | Issue | Mitigation |
|---|---|---|---|
| `/api/cron/signal-review` | **HIGH** | Loop processes signals via LLM council. No per-signal try/catch — one bad signal fails the whole cron → Vercel re-fires → same signal fails again next slot → LLM tokens burn each time. | Wrap each signal in try/catch; return partial results on failure; mark bad signals so they're skipped on subsequent runs |
| `/api/cron/rebuild-graph` | **MEDIUM** | `recordSamples()` writes observability metrics on every run. Re-fire = duplicate metric rows. | Add `(timestamp, agent_slug, kind)` dedup or tag with cron-run-id |
| `/api/cron/sync-memory` | **MEDIUM** | GitHub webhook receiver. Replayed webhook = duplicate mol_* rows. | Add `UNIQUE(scope_id, slug)` on mol_* tables (likely already there — verify) |
| `/api/cron/sweep-orphan-cards` | **LOW** | Idempotent (deletes by ID); already wrapped in try/catch. | None |
| `/api/cron/sync-learning-cards` | **LOW** | Idempotent upsert via `syncCardsFromMolecular`. | None |
| `/api/cron/post-deploy-smoke` | **LOW** | Read-only smoke probe. | None |
| `/api/cron/rebuild-graph-hq` | **LOW** | Idempotent rebuild. | None |
| `/api/cron/daily-extract`, `/api/cron/regression-sweep`, `/api/cron/metric-optimiser` | **LOW** | Local-only. | None |

### 4. Frontend retry / polling / Realtime patterns

| Page | Severity | Issue | Mitigation |
|---|---|---|---|
| `app/(protected)/tools/claw/status/page.tsx:87` | **MEDIUM** | `setInterval(fetchStatus, 8_000)` — no backoff on 5xx. Status endpoint failing = 7.5 calls/minute forever. | Exponential backoff: 8s → 16s → 32s capped at 60s; reset on 2xx |
| `app/(protected)/dashboard/org/page.tsx:135` | **MEDIUM** | `setInterval(fetchData, 15_000)` — same pattern. | Same fix |
| `app/(protected)/dashboard/page.tsx:72-109` | **LOW** | Supabase Realtime subscription with auto-reconnect. Supabase client handles backoff internally. | None |

### 5. Outbound external API calls

These are called by the routes/functions above. The risk is **per-attempt cost amplification** when a parent function retries.

| Module | Severity | Issue | Mitigation |
|---|---|---|---|
| `lib/claw/llm.ts` | **MEDIUM** | `callClaude` has no retry, but parents (research-loop, business-operator) retry the whole function → 3× LLM cost. Gateway health check at line 79 is per-call, not cached. | Set `maxRetries: 1` on `generateText()` calls; cache `isGatewayHealthy()` result for 30s |
| `lib/tools/tavily.ts` | **MEDIUM** | No internal retry. Inngest parent retry = 3× Tavily quota. Free tier 1k/mo. | Catch `AbortError` in research-loop; don't retry Tavily |
| `lib/firecrawl.ts` (hosted path) | **MEDIUM** | Similar to Tavily — caller retries amplify. | Add explicit `maxRetries: 0` in caller |
| `lib/memory/github.ts` | **MEDIUM** | `writePage` does GET-SHA then PUT. No idempotency on `appendToPage` — replayed n8n webhooks duplicate the same body. GitHub rate limit 5k/hr authenticated. | Check content-already-exists before append; honor `Retry-After` header |
| `lib/notion.ts` | **MEDIUM** | No retry, no timeout cap. 3 req/sec rate limit. Rarely used currently. | Add `AbortSignal.timeout(15000)` to all fetch calls |

### 6. Database writes that could fail+retry

| File | Severity | Issue | Mitigation |
|---|---|---|---|
| `lib/observability.ts::recordSamples` | **MEDIUM** | Fire-and-forget batch insert. Task completes → metrics logged → task crashes → restarts → metrics logged again. | Add `UNIQUE(user_id, agent_slug, kind, at)` with `ON CONFLICT DO NOTHING` |
| `lib/runs/measure-ingester.ts` | **LOW** | Single insert per phase advance, idempotent at the run-state level. | None |

### 7. Auto-promotion / observability writers

| File | Severity | Issue | Mitigation |
|---|---|---|---|
| `lib/library/promoter.ts` | **LOW** | Promotes successful-run output once per run. Run state machine prevents double-promotion. | None |
| `lib/runs/metric-triggers.ts` | **LOW** | Triggers optimiser on threshold crossing. Idempotent — re-checking yields same result. | None |

## Checklist for new code

Use this when adding any new external integration. If the answer to any "Does it…?" is "no", apply the mitigation in that row.

| Question | If no → apply | Why |
|---|---|---|
| Does the upstream caller auto-retry on 5xx? | Use **always-200 envelope** | Stop the retry before it starts |
| Does our handler include an idempotency key dedup? | Add `executionId` / `requestId` cache (Upstash Redis, 5-minute TTL) | Same event ≠ multiple side effects |
| Does the handler degrade gracefully if the schema is partially applied? | Use **fail-soft insert** pattern | 2026-05-03 incident class |
| Does the handler distinguish auth-class errors from transient ones? | Use **auth-cache** pattern | Stops cred-rotation spam |
| Does any DB call we make have a retry loop in the calling code? | Replace with single attempt + log + 200 | Don't compound failures |
| Is there a per-IP / per-user rate limit on the route? | Apply `lib/ratelimit.ts` | Leaked HMAC = unbounded calls |
| Does the route's spend tie back to `USER_DAILY_USD_LIMIT`? | Wire `lib/cost-guard.ts` | Final budget cap |
| Is the integration listed in `docs/SPEND_CAPS.md`? | Add row + set provider cap | Tier-1 financial safety |
| Does the handler complete in < 10s under failure? | Add a timeout | Vercel function-second budget |
| Are inbound webhook signatures verified, fail-closed in production? | Mirror the n8n / claw pattern | Prevent spoofed requests |

## Audit procedure

Re-run this any time you add a new external integration, after an incident, or quarterly.

```
Agent({
  description: "Audit repo for retry-storm vulnerabilities",
  subagent_type: "Explore",
  prompt: <the prompt below>,
})
```

Audit prompt template (paste verbatim):

```text
Audit the Nexus repo for retry-storm vulnerabilities. Look for:

1. Webhook handlers under app/api/webhooks/ — every route that returns 5xx
   on failure and is called by an external service that auto-retries.
   Include upstream retry policy (n8n: 3 attempts, claw: 5, Stripe: until
   4xx). Note idempotency.
2. Inngest functions under inngest/functions/ — Inngest auto-retries failed
   steps; list each + what it calls + amplification potential.
3. Vercel cron routes under app/api/cron/ — re-fire on schedule. List each
   + idempotency.
4. Frontend useEffect / setInterval / WebSocket reconnect patterns. Particular
   concern: Supabase Realtime auto-reconnect, "if error refetch in N
   seconds", auto-poll setIntervals.
5. Outbound external API calls without circuit breakers — anthropic, openai,
   elevenlabs, kling, runway, heygen, did, suno, udio, muapi, tavily,
   firecrawl, github memory, notion. Per file: retry on failure? backoff?
   max-attempts cap?
6. Database writes in retry loops — any
   `for (let i = 0; i < N; i++) { try { await db... } catch {} }` pattern.
7. Auto-promotion / library / observability writers — code that writes
   to DB on every run completion. If a run loops, these compound.

For each finding: HIGH / MEDIUM / LOW + file:line + one-sentence mitigation.
Report under 1000 words. Skip findings already mitigated:
- lib/board/insert-task.ts (fail-soft pattern)
- /api/cron/sweep-orphan-cards (try/catch wrapper)
- /api/vercel/log-drain (R2 mute)
```

Once the agent returns, copy its findings into Sections 1–7 above and commit.

## Related

- [docs/SPEND_CAPS.md](SPEND_CAPS.md) — provider caps & in-code guards
- [docs/ONBOARDING.md](ONBOARDING.md) — owner runbook
- [`lib/board/insert-task.ts`](../lib/board/insert-task.ts) — reference fail-soft pattern
- [`scripts/migrate.mjs`](../scripts/migrate.mjs) — reference exponential-backoff pattern
