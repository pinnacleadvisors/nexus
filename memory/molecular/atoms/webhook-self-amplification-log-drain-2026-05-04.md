---
type: atom
title: "Webhook self-amplification: Vercel log drain hit 70-100 req/s + 338MB middleware on 2026-05-04"
id: webhook-self-amplification-log-drain-2026-05-04
created: 2026-05-04
sources:
  - file://app/api/vercel/log-drain/route.ts
  - file://proxy.ts
  - file://lib/r2.ts
  - file://AGENTS.md
  - file://docs/RETRY_STORM_AUDIT.md
  - "git://8ef3868"
links:
  - "[[mocs/memory-and-cost-incidents]]"
status: active
importance: high
kind: incident
lastAccessed: 2026-05-04
accessCount: 0
---

# Webhook self-amplification: Vercel log drain hit 70-100 req/s + 338MB middleware on 2026-05-04

## Symptom

`/api/vercel/log-drain` was firing at 70-100 requests per second with 338MB middleware memory and 541MB function memory per invocation. Per-request duration ~290ms. Cost was burning silently because no individual call was expensive — the rate was the problem.

## Root cause: three concurrent issues amplified each other

1. **Self-amplification loop.** Every drain invocation produced a Vercel runtime log line (the function-invocation log itself). Vercel shipped that log line back to `/api/vercel/log-drain`. The receiver had no filter, so it ingested its own logs, generating more logs, generating more deliveries. Classic positive feedback.
2. **Clerk middleware running on the route.** [`proxy.ts`](../../../proxy.ts) matcher `'/(api|trpc)(.*)'` caught every API path including the drain. The drain authenticates via HMAC ([`route.ts`](../../../app/api/vercel/log-drain/route.ts) lines 115-134), so Clerk did nothing useful — but it loaded into memory at every invocation, adding ~338MB.
3. **AWS SDK eager-imported.** [`lib/r2.ts`](../../../lib/r2.ts) static-imported `S3Client`, `PutObjectCommand`, etc. at module top. Every cold start of the drain function loaded the full SDK (~200MB of V8 heap), even when R2 wasn't reached.

## Generalised pattern: webhook self-amplification

Receiver whose own output (logs, metrics, breadcrumbs) is fed back into itself by the same upstream that triggered it. Cousin of retry-storm — same family (failure / activity begets more activity), different mechanism. Cost grows superlinearly with rate.

Other shapes this pattern takes:
- Sentry breadcrumb collector that emits more breadcrumbs.
- Datadog/Axiom log forwarder pointing at an analytics endpoint that `console.log`s.
- An n8n webhook that calls back into n8n on success.

## Fix (commit `8ef3868`)

Four changes, one commit:

1. **Matcher exclusion** — [`proxy.ts`](../../../proxy.ts) negative-lookahead drops `/api/vercel/log-drain` from middleware. Saves the 338MB.
2. **Self-traffic filter** — [`route.ts`](../../../app/api/vercel/log-drain/route.ts) drops lines where `proxy.path === '/api/vercel/log-drain'` before any side effect. Breaks the feedback loop at the boundary.
3. **`after()` background writes** — R2 + Supabase moved off the response path. p95 dropped from 292ms → ~30ms.
4. **Lazy-load AWS SDK** — `lib/r2.ts` switched to `await import('@aws-sdk/client-s3')` inside each function. Cold-start memory dropped ~200MB on routes that don't reach R2.

## Forward-looking prevention

Documented in [`AGENTS.md`](../../../AGENTS.md) under "Webhook self-amplification checklist (log feedback loops)". Three buckets:

- New webhook receiver where the platform also observes its own invocations → filter `proxy.path === '<this route>'` at the boundary.
- New HMAC/signature-authenticated webhook → confirm the middleware matcher excludes it.
- Third-party drain pointing at a Nexus route → set the upstream's exclusion config on top of the receiver-side filter.

## Why this is filed under incidents and not retry-storm

The retry-storm audit ([`docs/RETRY_STORM_AUDIT.md`](../../../docs/RETRY_STORM_AUDIT.md)) covers failure-driven amplification (5xx → upstream retries → cost). This was activity-driven amplification — the system was working perfectly, generating logs that re-triggered itself. Different prevention surface, related cost shape.
