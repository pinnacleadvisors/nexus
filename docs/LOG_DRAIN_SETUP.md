# Vercel Log Drain — Setup Guide

> Updated: 2026-05-03 against the Vercel UI as of that date. Vercel periodically reshuffles labels — exact menu names may shift, but the underlying flow (create drain → set URL + secret → verify → activate) is stable.

## What this unlocks for Nexus

Three features depend on `log_events` being populated:

| Feature | Path | Without drain |
|---|---|---|
| Cron Health panel verdicts | `/manage-platform` → Health tab | Every cron shows **Unknown**; you can still see schedules, just no last-run data or HTTP status |
| Autonomous QA log slicing | `lib/logs/vercel.ts::attachLogsToBrief` | Fix-attempt dispatches go out without the 30-second log window — Claude has to debug blind |
| Generic log search | `POST /api/logs/slice` | Returns empty results |

If you don't use any of those, the drain is optional. If you want the Health panel to actually tell you when a cron silently stops running, set this up.

> **Slack verification does NOT depend on log drain.** It's an inline HTTP check that runs the moment you save a webhook URL. See [lib/slack/client.ts](../lib/slack/client.ts).

## Prerequisites

| Requirement | Why |
|---|---|
| Vercel **Pro** or higher | Log drains are a paid feature. The Hobby/Free tier shows no Drains menu. As of 2026 a single-seat Pro is $20/mo. |
| `VERCEL_LOG_DRAIN_SECRET` in Doppler | HMAC secret. Generate with `openssl rand -hex 32`. |
| (Optional) `R2_*` env vars | Without R2, drain still works — log_events is populated, just no immutable raw archive. |
| Migration `022_log_events` applied | The table the drain writes to. Already in the repo. |
| The deployment URL of your project | Public-by-design endpoint at `https://<your-domain>/api/vercel/log-drain`. |

## Step-by-step (latest UI)

### 1. Generate the HMAC secret

```bash
openssl rand -hex 32
# 64-char hex string — copy it
```

Add to Doppler under both `dev` and `prd` configs as `VERCEL_LOG_DRAIN_SECRET`. Push Doppler → Vercel; wait for redeploy.

### 2. Verify the endpoint is reachable

Before configuring the drain, sanity-check that the receiver is up. Vercel's "Create Drain" wizard probes with a GET request before activating:

```bash
curl https://<your-domain>.vercel.app/api/vercel/log-drain
# Expected:  {"ok":true,"drain":"ready","accepts":"POST application/x-ndjson"}
```

If you get a 401 or 404 instead, the deploy doesn't have the route yet — pull main and redeploy.

### 3. Open the Drains UI

There are two viable entry points; both reach the same place. Use whichever matches your current Vercel UI:

**Path A — Team scope (recommended, drains apply across all projects in the team):**
1. From [vercel.com/dashboard](https://vercel.com/dashboard), click your **team name** in the top-left dropdown.
2. Click **Settings** (gear icon) in the team navigation.
3. In the left sidebar, look for **Log Drains** (older UI) or **Observability → Drains** (newer UI rolled out late 2025).

**Path B — Project scope (drain only one Nexus deployment):**
1. Click into your Nexus project.
2. **Settings** tab.
3. Sidebar: **Logs** → **Drains**, or **Observability** → **Drains** depending on UI version.

If you can't see either menu, your team is on Hobby — the Drains setting is gated to Pro+.

### 4. Create the drain

Click **Add Drain** (or **Create Drain** in newer UI). The wizard asks for:

| Field | Value |
|---|---|
| **Name** | `nexus-log-events` (anything memorable; shows in the drains list) |
| **Sources** | Select **Functions** at minimum. **Edge** is optional but cheap. **Build** is noisy and not used by Nexus. **Static** is irrelevant. |
| **Environments** | Production at minimum. Adding Preview lets you debug PR deploys; adding Development pulls vercel dev locally — usually skip. |
| **Projects** (team-scoped only) | Select your Nexus project. |
| **Delivery format** | **JSON** (the receiver expects NDJSON; Vercel calls it "JSON" in the dropdown — same thing) |
| **Endpoint URL** | `https://<your-domain>/api/vercel/log-drain` — use your production domain, not a preview URL |
| **Custom secret** (or **Signing secret**) | Paste the value of `VERCEL_LOG_DRAIN_SECRET` you generated in step 1 |
| **Custom headers** | Leave empty. Auth is via HMAC, not bearer. |
| **Sampling rate** | `100%` — Nexus is low-volume; sampling defeats the Health panel's purpose. |

### 5. Activate

Click **Create Drain** (or **Save**). Vercel runs three checks:
1. GET to your endpoint expecting 2xx (the receiver returns 200 + `{ok:true,…}`).
2. POST a tiny test batch to confirm acceptance.
3. Verify the HMAC signature matches.

If any fail, the drain stays in **inactive** state with an error message in the dashboard. See **Troubleshooting** below.

### 6. Confirm data is flowing

Within ~60 seconds of activation:

```sql
-- Run in Supabase SQL editor
SELECT created_at, route, status, duration_ms, message
FROM log_events
ORDER BY created_at DESC
LIMIT 20;
```

You should see rows. If `route` is mostly `null`, your traffic is hitting static assets or pages (not API routes) — that's fine; the drain captures everything.

Then visit `/manage-platform` → **Health** tab. Cron rows that previously showed **Unknown** should turn **green** the next time each cron fires (or red/amber if there's a real issue).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Wizard says "endpoint returned non-2xx" | Domain typo, deploy still building, or `VERCEL_LOG_DRAIN_SECRET` not set | Re-run the curl in step 2; check Doppler is synced to Vercel |
| Wizard says "Your endpoint sent a 401 status instead of 2xx" | Either (a) custom secret in the wizard ≠ `VERCEL_LOG_DRAIN_SECRET` in Doppler, or (b) you're on a deploy that predates the SHA-1 fix. | Vercel signs Log Drain payloads with **HMAC-SHA1** (raw hex, no `sha1=` prefix). The receiver as of commit `<this PR>` accepts both SHA-1 and SHA-256; older deploys only accepted SHA-256 → silent 401. Pull main + redeploy, then verify both secrets match exactly. |
| Drain active but no rows in `log_events` | Receiver returning 401 (`bad_signature`) — same root cause as above. | Check `vercel logs --follow` while the drain is active. The receiver logs `header_len=` (40 = sha1, 64 = sha256) and the expected digest prefixes — that confirms whether the algorithm or the secret is wrong without exposing the secret itself. |
| Drain active, R2 errors in receiver logs | R2 envs missing or wrong | Drain still writes to `log_events` — R2 is optional archive. Set `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ACCOUNT_ID` if you want the immutable raw archive. |
| `log_events` populating but Health panel still shows Unknown for one cron | Cron path string in `app/api/health/cron/route.ts` `CRONS` array doesn't match the path Vercel is logging (e.g. `?reconcile=1` query string) | The route already strips query strings via `spec.path.split('?')[0]`. If still mismatched, check the actual `route` value in `log_events` for that cron and align. |
| Drain marked **inactive** by Vercel after a while | Endpoint returned 5xx for too many consecutive batches | Vercel auto-disables drains that fail repeatedly. Check the receiver logs (`vercel logs --project=nexus`); fix the cause; re-enable in the Drains UI. |
| 401 errors in receiver logs from Vercel itself | Old secret rotation in progress | After rotating `VERCEL_LOG_DRAIN_SECRET`, you must update the value in the Vercel Drain config too. Doppler push doesn't propagate to Vercel's drain settings. |

## Cost notes

| Item | Cost (as of 2026) |
|---|---|
| Vercel Pro | $20/seat/mo (drains require Pro) |
| R2 storage (1 GB ≈ 6 months of Nexus logs) | ~$0.015/mo |
| R2 Class A operations (writes) | First 1M ops/mo free; Nexus drain hits ~30k ops/mo at modest traffic |
| Supabase row storage | Negligible — `log_events_purge_older_than(30)` keeps the table small |

The biggest variable is `log_events` table size. Run this nightly to keep it bounded:

```sql
SELECT log_events_purge_older_than(30);
-- Drops rows older than 30 days; raw NDJSON stays in R2 for archive
```

You can wire this into a cron job. Add to `vercel.json`:

```json
{ "path": "/api/cron/purge-log-events", "schedule": "0 3 * * *" }
```

(That endpoint isn't built yet — would be ~10 lines if you want it; flag and I'll add it.)

## Alternatives if you skip the drain

If you don't want to pay for Pro just for the Health panel, two workarounds:

1. **Best-effort cron tagging** — modify each cron route to write an audit_log row on success/failure. Build a `/api/health/cron-audit` that reads those instead of `log_events`. Not free either (every cron writes a row) but works on Hobby.
2. **Self-hosted log relay** — point the drain at a free service (Better Stack, Axiom) that webhooks back to your endpoint. Adds a hop but bypasses Vercel's Pro requirement. Messy; only worth it if you're going to host your own logging stack anyway.

For most operators on a single-deploy single-business setup, the simplest path is "skip the drain, accept Unknown verdicts, rely on Slack alerts from each cron route's own error path." That's the default experience — no setup needed.

## Related

- Receiver: [app/api/vercel/log-drain/route.ts](../app/api/vercel/log-drain/route.ts)
- Search helpers: [lib/logs/vercel.ts](../lib/logs/vercel.ts)
- Migration: [supabase/migrations/022_log_events.sql](../supabase/migrations/022_log_events.sql)
- Health panel that consumes the data: [components/admin/HealthPanel.tsx](../components/admin/HealthPanel.tsx)
- Health endpoint: [app/api/health/cron/route.ts](../app/api/health/cron/route.ts)
- Onboarding (high-level mention): [docs/ONBOARDING.md](ONBOARDING.md)
