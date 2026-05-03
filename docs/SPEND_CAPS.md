# Nexus — Spend Caps & Cost Guards

> Living reference. **When you add a new external service or paid integration, append a row to the relevant table** and check whether a cap is needed at: (1) the provider dashboard, (2) the env-var layer, (3) the in-code guard layer. The "How to add a new service" section at the bottom walks through all three in under 5 minutes.

## Why this exists

On 2026-05-03 a single missing-migration cascade burned **$100 of Vercel credits** and pushed **Supabase egress from 0 to 14.49 GB** in a few hours. The root cause was preventable in code (see [docs/RETRY_STORM_AUDIT.md](RETRY_STORM_AUDIT.md)), but the financial blast radius would have been bounded if every paid surface had a hard cap. This document is the canonical list of those caps so adding a new tool can never silently re-introduce the same failure mode.

The platform follows **defense in depth** — three layers, each catches different failure modes:

| Layer | What it catches | Who configures |
|---|---|---|
| **Provider dashboard cap** | Runaway loops despite our code | Set on each provider's billing page |
| **Env-var soft cap** | Per-user / per-business daily ceilings | Doppler env vars read by `lib/cost-guard.ts` |
| **In-code guard** | Detected anomalies (pattern matching, circuit breakers) | Helpers under `lib/` invoked by routes |

---

## Tier 1 — External services that bill per call

Every row here MUST have a hard provider-dashboard cap. Sorted by per-call cost descending — top of the list is where a runaway costs the most.

### Already capped

| Service | Cap | Set in | Last verified |
|---|---|---|---|
| **Anthropic API** | (configured) | console.anthropic.com → Settings → Limits → Monthly hard limit | 2026-05-03 |
| **Vercel** | (configured) | vercel.com → team Settings → Usage → Spend Cap | 2026-05-03 |
| **Supabase** | (configured) | supabase.com → project → Reports → Spend Cap | 2026-05-03 |

### Needed if/when the integration is enabled

These are providers whose code paths exist in the repo but where credentials may or may not be set. **As soon as you add a key to Doppler, set the cap.**

| Service | Per-unit cost | Code path | Suggested cap | Where to set |
|---|---|---|---|---|
| **OpenAI** | $0.01–$0.15 / 1k tokens | (none yet — fallback only) | $20/mo | platform.openai.com → Limits |
| **Tavily web search** | $0.005 / query | `lib/tools/tavily.ts` | $10/mo | tavily.com → Account → Usage |
| **Kling AI** (cinematic video) | $0.10–$0.50 / clip | `lib/video/kling.ts` | $20/mo | kling.ai → Billing |
| **Runway** (video) | $0.05–$1.00 / clip | `lib/video/runway.ts` | $20/mo | runwayml.com → Plan |
| **ElevenLabs** (voice) | $0.30 / 1k chars | `lib/audio/elevenlabs.ts` (planned 18b) | 50k chars/mo | elevenlabs.io → Subscription |
| **HeyGen** (avatar) | $0.10–$2.00 / video | `lib/video/heygen.ts` (planned 18c) | $20/mo | heygen.com → Account |
| **D-ID** (talking-head fallback) | $0.10–$0.50 / video | `lib/video/did.ts` (planned 18c) | $10/mo | d-id.com → Account |
| **Suno** (music) | $0.10 / track | `lib/audio/suno.ts` (planned 18b) | $10/mo | suno.com → Plan |
| **Udio** (music) | $0.10 / track | `lib/audio/udio.ts` (planned 18b) | $10/mo | udio.com → Plan |
| **muapi.ai** (image) | per image | (planned 12b) | $10/mo | muapi.ai → Account |
| **Resend** (email) | $0.0004 / email | `lib/email/resend.ts` | Free tier (3k/mo) | resend.com → Plan |
| **DeerFlow 2.0** (research sidecar) | Railway hosting flat fee | `lib/deerflow/client.ts` (planned 17a/b) | Railway plan | railway.app project |
| **Firecrawl** (hosted) | per scrape | `lib/firecrawl.ts` | $25/mo | firecrawl.dev → Plan |
| **Composio** (Doppler broker) | per action | `app/api/composio/doppler/route.ts` | $10/mo | composio.dev → Account |

### Self-hosted (capped by hosting fee, not per-call)

| Service | Hosting cost | Code path | Notes |
|---|---|---|---|
| **Claude Code gateway** | Hostinger+Coolify VPS, ~$15/mo | `services/claude-gateway/` | Drains the 20× Max plan; no per-call billing |
| **Self-hosted Firecrawl** | KVM4 instance, ~$5/mo | `services/firecrawl/` | Free of per-scrape cost once running |
| **n8n self-hosted** | Coolify | `services/n8n/` (if used) | Free per workflow |
| **Brevo / Umami / GlitchTip** (Phase 21) | Containers | not yet | Replacing Resend / Sentry when ready |

---

## Tier 2 — Free-tier services with quotas (set ALERT, not cap)

Crossing these doesn't bill — it throttles or stops the service. An alert at ~80% gives you time to upgrade or investigate.

| Service | Free quota | Alert at | Code path |
|---|---|---|---|
| **Cloudflare R2** | 10 GB storage / 1M Class A ops/mo | 8 GB / 800k ops | `lib/r2.ts` |
| **Upstash Redis** | 10k commands/day | 8k/day | `lib/ratelimit.ts` |
| **Inngest** | 50k steps/mo (hobby) | 40k steps | `inngest/functions/*` |
| **Sentry** | 5k events/mo | 4k events | `sentry.*.config.ts` |
| **Clerk** | 10k MAU | n/a single-owner | `proxy.ts` |
| **GitHub** (memory-hq) | 5k API calls/hr per token | 4k/hr | `lib/memory/github.ts` |
| **Notion** | 3 req/sec | rate-limited at API | `lib/notion.ts` |
| **Vercel Hobby** (if not Pro) | 100 GB bandwidth/mo, 100h fn-secs | 80 GB / 80h | n/a |
| **Stripe** | no usage cap | watch for unusual volume in dashboard | `app/api/webhooks/stripe/route.ts` |

---

## Tier 3 — In-code guards (already in the repo)

These run on every request and are the primary defense against in-app loops. Each one short-circuits before reaching a paid service.

| Guard | File | Default | What it catches |
|---|---|---|---|
| `USER_DAILY_USD_LIMIT` (default $25) | `lib/cost-guard.ts` | env var | All Anthropic/OpenAI calls billed to a user; HTTP 402 over budget |
| `USER_BUSINESS_DAILY_USD_LIMIT` | `lib/cost-guard.ts` | env var | Same as above scoped to one business |
| Webhook fail-closed in production | `app/api/webhooks/{n8n,claw}/route.ts` | env-var presence | Returns 503 if `N8N_WEBHOOK_SECRET` / `OPENCLAW_BEARER_TOKEN` missing |
| Lineage-aware insert (`insertTask`) | `lib/board/insert-task.ts` | runtime detection | Caches missing-column once, falls back to lineage-free insert (prevents the 2026-05-03 incident class) |
| R2 auth-fail mute | `app/api/vercel/log-drain/route.ts` | runtime detection | One log on first SignatureDoesNotMatch, then silent — no spam from per-invocation drain |
| Migrate retry/backoff | `scripts/migrate.mjs` | 4 attempts | Cold-start tolerant (HTTP 544 / 522 / 524 / 502 / 503 / 504) |
| Sweep-orphan-cards safety net | `app/api/cron/sweep-orphan-cards/route.ts` | try/catch + warnings | Always returns JSON, never lets Next.js return HTML 500 |
| Slack silent-fail detection | `lib/slack/client.ts::postVerification` | response body match | Catches "200 OK but body !== 'ok'" — channel archived, app revoked, etc. |
| `(protected)/error.tsx` | `app/(protected)/error.tsx` | error boundary | One-page crash doesn't take down the shell |

### Missing — recommended additions (tracked in `docs/RETRY_STORM_AUDIT.md`)

| Guard | Where it would live | Priority |
|---|---|---|
| `NEXUS_KILL_SWITCH=true` env var | new `lib/kill-switch.ts` | HIGH — single toggle to halt all paid calls during an incident |
| Per-cron failure circuit breaker | new `lib/health/circuit-breaker.ts` | MEDIUM — `failure_count > 3 within 1h` → pause |
| Slack alerts at 50/80/95% of cost-guard | extend `lib/cost-guard.ts` | MEDIUM — early warning before HTTP 402 |
| Per-IP rate limit on webhook routes | apply existing `lib/ratelimit.ts` | MEDIUM — leaked HMAC = unbounded calls |
| Per-business daily action ceiling | `lib/business/operator.ts` | LOW — cap 30 actions/day before requiring approval |
| Realtime subscription kill switch | `app/(protected)/board/page.tsx` (env-gated) | LOW — incident lever |

---

## Tier 4 — Operational tripwires (alerts, not blocks)

Configure these on the provider side. They don't block traffic; they tell you something is wrong **before** the cap fires.

- [ ] **Slack alert at 50/80/95% of each daily budget** — extend `lib/cost-guard.ts` to ping Slack via `postSlackNotification` at intermediate thresholds
- [ ] **Sentry error-rate spike alert** — Sentry → Alerts → Issues → "Errors per hour" rule, threshold = 10× baseline
- [ ] **Vercel function-invocations-spike alert** — Vercel → Settings → Notifications → Usage alerts → Functions
- [ ] **n8n "execution failed N times" rule** — In each n8n workflow, wire the error-trigger node to the Slack webhook
- [ ] **Stripe Radar velocity rule** — `revenue_events` per hour > expected → notify
- [ ] **`/api/health/db` external monitor** — Better Stack / GitHub Actions / cron-job.org pinging every 5 min, alarm if `overall_ok: false` or latency > 2s
- [ ] **Supabase egress webhook** — supabase.com → Project Settings → Notifications → "Egress at 80% of plan" → Slack

---

## How to add a new service to this list

When you add a new external integration to the codebase:

1. **Identify the per-unit cost** — per token / per request / per asset / per minute.
2. **Add a row to Tier 1 or Tier 2** in this file with: service name, cost, code path, suggested cap, dashboard URL.
3. **Set the cap in the provider dashboard** before merging the integration code. If the provider doesn't offer a hard cap, set the lowest possible auto-pause threshold.
4. **Wire `lib/cost-guard.ts`** to track usage if the service is per-token (so it counts against `USER_DAILY_USD_LIMIT`).
5. **Add a row to `docs/RETRY_STORM_AUDIT.md`** classifying retry behavior of any callbacks the service makes (auto-retry policy + idempotency of our handler).
6. **If the service has webhooks**, ensure the receiving route:
   - Verifies a signature
   - Returns 200 even on partial failure (so the upstream doesn't retry)
   - Uses fail-soft inserts (see `lib/board/insert-task.ts` pattern)
7. **Update `docs/ONBOARDING.md`** "Adding optional capabilities" table.

The cost of these 7 steps is ~10 minutes; the cost of skipping them in 2026-05-03 was $100 + 14 GB of egress.

---

## Audit cadence

Every quarter (or after any incident with measurable cost impact), run through:

1. **Walk every row in Tier 1.** Confirm the cap is still set. Providers occasionally reset caps after plan changes.
2. **Compare Doppler env vars to this file.** A new env var in Doppler that isn't listed here → an integration was added without going through the checklist above.
3. **Run `node scripts/audit-spend-caps.mjs`** (planned) — scans the repo for `process.env.*_API_KEY` patterns and flags any not appearing in Tier 1.
4. **Re-read `docs/RETRY_STORM_AUDIT.md`.** Add any new findings.

---

## Related

- [docs/RETRY_STORM_AUDIT.md](RETRY_STORM_AUDIT.md) — vulnerability audit + checklist for new code
- [docs/ONBOARDING.md](ONBOARDING.md) — owner runbook
- [memory/platform/SECRETS.md](../memory/platform/SECRETS.md) — env-var index
- [lib/cost-guard.ts](../lib/cost-guard.ts) — primary in-code spend tracker
