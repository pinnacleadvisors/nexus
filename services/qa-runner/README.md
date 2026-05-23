# Nexus qa-runner

Autonomous post-deploy QA service. Runs headless Playwright smoke specs
against the live Vercel deployment, fetches Vercel server logs on failure,
and dispatches a fix-attempt to the self-hosted Claude Code gateway.

Plan-billed by construction: a clean deploy = 0 tokens. A failing deploy =
one dispatch through the gateway (your 20× Max plan).

```
Vercel cron (/api/cron/post-deploy-smoke)
  └─ HMAC POST → qa-runner:/run
        ├─ POST /api/admin/issue-bot-session → Clerk sign-in ticket URL
        ├─ npx playwright test --workers=1
        │     └─ Tier 1 smoke spec hits /dashboard /forge /board /tools /graph
        └─ on failure
              ├─ POST /api/logs/slice → 30 s Vercel log markdown
              ├─ POST gateway /api/sessions/qa-runner-smoke/messages
              └─ POST /api/workflow-feedback (so the optimiser loop sees it)
```

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Two-stage build on `mcr.microsoft.com/playwright:v1.49.0-noble`. |
| `docker-compose.yaml` | Coolify resource template. Joins the `coolify` network to talk to `claude-gateway` privately. |
| `playwright.config.ts` | Single chromium project, headless, single worker. |
| `e2e/smoke.spec.ts` | Tier 1 smoke spec — status / heading / console / 5xx checks. |
| `src/auth.ts` | HMAC verify (inbound webhook) + sign (outbound Nexus calls). |
| `src/runSpec.ts` | Spawns `playwright test`, parses JSON report → pass/fail summary. |
| `src/dispatch.ts` | Issues bot ticket; fetches log slice; dispatches gateway fix-attempt; files workflow feedback. |
| `src/index.ts` | Hono HTTP server + orchestration loop. |

## Local dev

```bash
cd services/qa-runner
npm install
npx playwright install chromium     # first run only

# Point at a local Nexus + a local gateway for a dry-run
export BASE_URL=https://your-nexus-preview.vercel.app
export NEXUS_BASE_URL=$BASE_URL
export BOT_ISSUER_SECRET=<...>
export BOT_CLERK_USER_ID=user_<qa-bot id>
export BOT_API_TOKEN=<...>
export CLAUDE_GATEWAY_URL=http://localhost:3000
export CLAUDE_GATEWAY_BEARER=<...>
export QA_RUNNER_HMAC_SECRET=<...>

npm run dev
# In another shell:
BODY='{"baseUrl":"'$BASE_URL'"}'
TS=$(date +%s%3N)
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$QA_RUNNER_HMAC_SECRET" -hex | cut -d' ' -f2)"
curl -X POST http://localhost:3001/run \
  -H "Content-Type: application/json" \
  -H "X-Nexus-Signature: $SIG" \
  -H "X-Nexus-Timestamp: $TS" \
  --data "$BODY"
```

You should see the runner log `[qa-runner] starting smoke against …` and
either `smoke passed` or `smoke failed: N test(s)`. On failure check the
gateway logs for the dispatched session.

## Deploy on Coolify (next to claude-gateway)

1. Create a new Coolify resource → Docker Compose → paste the contents of
   `services/qa-runner/docker-compose.yaml`.
2. Wire env vars from your secret store (Doppler, 1Password, etc.):
   - `QA_RUNNER_HMAC_SECRET` — generate with `openssl rand -hex 32`
   - `BASE_URL` — public Vercel URL (e.g. `https://nexus.example.com`)
   - `NEXUS_BASE_URL` — usually the same as `BASE_URL`
   - `BOT_ISSUER_SECRET`, `BOT_CLERK_USER_ID`, `BOT_API_TOKEN`
   - `CLAUDE_GATEWAY_URL` (default `http://claude-gateway:3000`),
     `CLAUDE_GATEWAY_BEARER`
3. Add Cloudflare Tunnel ingress: `qa-runner.<your-domain>` → `qa-runner:3001`.
4. Deploy. Healthcheck hits `GET /health` on :3001.
5. Add the public URL to Doppler as `QA_RUNNER_WEBHOOK_URL` so
   `/api/cron/post-deploy-smoke` can reach it.

## Manual setup checklist (do these once, end-to-end)

> Everything above is committed code. The list below is the human work the
> runner can't do for itself. Do it after `vercel deploy` has shipped this PR.

### 1. Create the qa-bot Clerk user

- Clerk dashboard → **Users** → **+ Create user**
- Email: `qa-bot@<your-domain>` (any address you control — Clerk verifies via
  the magic link / OAuth path you choose).
- Copy the resulting **User ID** (`user_xxxxxxxx…`).
- Verify in **Configure → Restrictions** that **Block sign-ups** is still ON.

### 2. Add the bot to your allowlist

In Doppler (or Vercel env), append to `ALLOWED_USER_IDS`:

```
ALLOWED_USER_IDS=user_<your-id>,user_<qa-bot-id>
```

### 3. Generate and store the bot secrets in Doppler

```bash
doppler secrets set BOT_CLERK_USER_ID=user_<qa-bot-id>
doppler secrets set BOT_API_TOKEN=$(openssl rand -hex 32)
doppler secrets set BOT_ISSUER_SECRET=$(openssl rand -hex 32)
doppler secrets set QA_RUNNER_HMAC_SECRET=$(openssl rand -hex 32)
doppler secrets set QA_RUNNER_WEBHOOK_URL=https://qa-runner.<your-domain>/run
doppler secrets set VERCEL_LOG_DRAIN_SECRET=$(openssl rand -hex 32)
```

(Don't enable `CLAUDE_MAX_ONLY=1` until you've watched a few smoke runs land
through the gateway successfully — see `task_plan-autonomous-qa.md` Q3
follow-up list for the call sites still on the API path.)

### 4. Wire log access (Vercel-deployed Nexus)

> Skip to **§4-Coolify** below if your Nexus is deployed on Coolify, not Vercel.

- Vercel → Project → **Settings → Log Drains** → **Add Log Drain**
- Type: **JSON**
- Endpoint: `https://nexus.<your-domain>/api/vercel/log-drain`
- Secret: paste `VERCEL_LOG_DRAIN_SECRET` from step 3.
- Sources: function + edge logs.
- Save. Vercel will start pushing within ~30 s.

Verify a row landed:

```sql
select count(*) from log_events
 where created_at > now() - interval '5 minutes';
```

### 4-Coolify. Coolify-deployed Nexus — log path alternatives

When `vercel.json` has `"deploymentEnabled": false` and Nexus runs on Coolify, the Vercel log drain doesn't apply. Three options, in order of operator effort:

**A. Skip log drain (recommended for v1).** qa-runner still works; failures just lose the 30 s log-slice context. The dispatched fix-attempt has the Playwright failure text + screenshot + trace — usually enough to diagnose. Migration 022 is still optional in this mode.

**B. Vector sidecar (full log parity).** Add a `vector` container to your Nexus docker-compose that tails container stdout and POSTs to `https://nexus.<your-domain>/api/vercel/log-drain`. The log-drain endpoint accepts any JSON shape — name is historical, not Vercel-specific.

**C. Coolify scheduled task to scrape `docker logs`.** Lower-fidelity than Vector; only use if A and B are blocked.

### 5. Apply the migration

```bash
npm run migrate                    # reads supabase/migrations/022_log_events.sql
```

Skip if you picked Option A in §4-Coolify — `log_events` table is unused.

### 6. Deploy the qa-runner service on Coolify

Follow the **Deploy on Coolify** steps above. Confirm `GET /health` returns
200 and that `docker logs qa-runner | tail` shows `[qa-runner] listening on :3001`.

### 7. Smoke-test the end-to-end loop

> See **§7-Coolify** below for the Coolify-deployed Nexus path. The flow is identical; only the auth header differs (bot bearer instead of Vercel `CRON_SECRET`).

```bash
# Vercel cron auth — Vercel injects Authorization: Bearer $CRON_SECRET
curl -X POST https://nexus.<your-domain>/api/cron/post-deploy-smoke \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"baseUrl":"https://nexus.<your-domain>"}'
```

You should see in `docker logs qa-runner`:

```
[qa-runner] starting smoke against https://nexus.<your-domain>
[qa-runner] smoke passed (5 tests, 18000ms) — no dispatch
```

To force a dispatch and prove the loop end-to-end, temporarily break a route
(e.g. throw in `app/(protected)/dashboard/page.tsx`), redeploy, and watch the
gateway logs for the dispatched session.

### 7-Coolify. Coolify-deployed Nexus — smoke + cron scheduling

Two differences from the Vercel path: auth uses the bot bearer (not `CRON_SECRET`), and *something else* has to fire the cron route on a schedule because Vercel crons are inactive when deploys are disabled.

**Manual smoke test (anytime — owner-equivalent via bot token):**

```bash
# Pull what you need from Doppler. Bot user is in ALLOWED_USER_IDS so its
# bearer is owner-equivalent for hitting the cron route directly.
BOT_API_TOKEN=$(doppler secrets get BOT_API_TOKEN --project nexus --plain)
NEXUS_BASE_URL=$(doppler secrets get NEXUS_BASE_URL --project nexus --plain)

curl -X POST "$NEXUS_BASE_URL/api/cron/post-deploy-smoke" \
  -H "Authorization: Bearer $BOT_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"baseUrl\":\"$NEXUS_BASE_URL\"}"
```

Expected response: `{ "ok": true, "dispatched": true, "baseUrl": "..." }`. Then check qa-runner logs in Coolify for the smoke output.

**Schedule the trigger (pick one — replaces the Vercel cron entry in `vercel.json`):**

| Option | How |
|---|---|
| Coolify scheduled task | On your Nexus Coolify resource → **Scheduled Tasks** → add `curl -fsS -X POST -H "Authorization: Bearer $BOT_API_TOKEN" "$NEXUS_BASE_URL/api/cron/post-deploy-smoke"` with frequency `*/30 * * * *`. Inject `BOT_API_TOKEN` + `NEXUS_BASE_URL` from the same Doppler config. |
| n8n cron workflow | If n8n is already running, add a **Schedule trigger** → **HTTP Request** node hitting the cron URL with the bot bearer. Same `*/30 * * * *`. |
| External cron service | cron-job.org / EasyCron — same recipe. Lowest-rate-limit but external dependency. |
| Manual only | Don't schedule. Smoke after each deploy by hand using the curl above. Fine for early-stage operation. |

**Diagnosing common failures:**

| Response | Probable cause | Fix |
|---|---|---|
| `{ ok: true, skipped: true, reason: 'qa_runner_not_configured' }` | `QA_RUNNER_WEBHOOK_URL` or `QA_RUNNER_HMAC_SECRET` missing from Doppler | `doppler secrets set QA_RUNNER_WEBHOOK_URL=https://qa-runner.<your-tunnel>/run`. Redeploy Nexus on Coolify. |
| `{ ok: false, error: 'qa_runner_502', detail: '...' }` | qa-runner container unreachable at that URL | Coolify → qa-runner resource → Logs. Check it booted on :3001 and the Cloudflare Tunnel ingress is healthy. |
| `{ ok: false, error: 'qa_runner_401', detail: 'bad_signature' }` | HMAC mismatch — `QA_RUNNER_HMAC_SECRET` differs between Nexus env and qa-runner env | Both must read the SAME Doppler secret. Confirm both Coolify resources are wired to the same Doppler config. Redeploy both. |
| `{ ok: false, error: 'no_base_url' }` | `NEXUS_BASE_URL` (or `QA_RUNNER_BASE_URL`) unset in Doppler AND `baseUrl` not passed in body | Set `NEXUS_BASE_URL=https://nexus.<your-domain>` in Doppler. Redeploy Nexus. |

## Operational notes

- **RAM**: a single Chromium ~600 MB resident, peak ~1.2-1.5 GB. On a 2 GB
  VPS this will swap when stacked next to claude-gateway. Bump to 4 GB or
  keep `PLAYWRIGHT_WORKERS=1`.
- **Plan budget**: the gateway is single-worker FIFO. The runner uses
  `sessionTag=qa-runner-smoke` so dispatches show up distinctly in
  `[gw] POST /api/sessions/qa-runner-smoke/...` log lines.
- **Auto-merge**: nothing here merges anything. The optimiser loop reads
  `workflow_feedback` rows the runner files; PRs land via `/api/build/diff`
  for human review.
