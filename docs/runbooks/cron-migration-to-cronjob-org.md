# Runbook — migrate Vercel crons to cron-job.org

After Vercel decommission, the 10 cron jobs in [`vercel.json`](../../vercel.json) stop firing. This runbook migrates them to cron-job.org — same `/api/cron/*` endpoints, same `CRON_SECRET` auth, just a different scheduler hitting them.

**Why cron-job.org?** Free tier covers 10 jobs easily. $5 donation unlocks higher limits + priority — still cheaper than Vercel Pro ($20/mo) and we're only paying for crons.

## One-time setup

### 1. Sign up + API key

1. Sign up at https://cron-job.org (email + password)
2. (Optional) Donate $5 via the link in the dashboard for higher tier
3. Dashboard → **Settings** → **API** → **Create API key** → copy the value

### 2. Add to Doppler

```bash
echo "<paste-api-key>" | doppler secrets set CRONJOB_ORG_API_KEY --config prd --project nexus
```

`CRON_SECRET` and `NEXUS_BASE_URL` should already be in Doppler (`prd`). Verify with:
```bash
doppler secrets --config prd --project nexus --only-names | grep -E "CRON_SECRET|NEXUS_BASE_URL|CRONJOB"
```

### 3. Dry-run

```bash
doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --dry-run
```

Expected output: list of 10 jobs from `vercel.json` with their schedules + target URLs (all pointing at `$NEXUS_BASE_URL`). No API writes happen.

### 4. Apply

```bash
doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --apply
```

Idempotent — skips jobs whose title already matches the `Nexus: …` convention. Safe to re-run.

### 5. Verify

```bash
doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --list
```

Should show 10 `Nexus: …` jobs alongside any non-Nexus jobs you may have. Star (★) marks Nexus-prefixed ones.

In the cron-job.org dashboard, each job should show "Status: enabled, next execution: …". After the first scheduled fire, check the **Execution history** tab — successful hits show HTTP 200 with the response body. Failures send email alerts.

## What gets created

10 cron jobs (matching `vercel.json` exactly):

| Title | URL | Schedule |
|---|---|---|
| `Nexus: signal-review` | `$NEXUS_BASE_URL/api/cron/signal-review` | `0 8 * * *` (daily 8am UTC) |
| `Nexus: rebuild-graph-hq` | `…/api/cron/rebuild-graph-hq` | `0 */6 * * *` (every 6h) |
| `Nexus: sync-memory (?reconcile=1)` | `…/api/cron/sync-memory?reconcile=1` | `0 4 * * *` |
| `Nexus: post-deploy-smoke` | `…/api/cron/post-deploy-smoke` | `*/30 * * * *` |
| `Nexus: sync-learning-cards` | `…/api/cron/sync-learning-cards` | `0 5 * * *` |
| `Nexus: sweep-orphan-cards` | `…/api/cron/sweep-orphan-cards` | `30 4 * * *` |
| `Nexus: audit-prune` | `…/api/cron/audit-prune` | `0 6 * * *` |
| `Nexus: scale-down-businesses` | `…/api/cron/scale-down-businesses` | `*/30 * * * *` |
| `Nexus: solopreneur-tick` | `…/api/cron/solopreneur-tick` | `0 9,12,15,21 * * *` |
| `Nexus: codex-maintainer-tick` | `…/api/cron/codex-maintainer-tick` | `*/30 * * * *` |

Each job:
- HTTP method: `GET`
- Header: `Authorization: Bearer $CRON_SECRET` (matches what `/api/cron/*` routes validate)
- Notifications: email on failure + on disable, silent on success
- Save response: enabled (for debugging)

## After cron-job.org confirms working

**Verify for ~24h** that every job fires at its expected time and returns 200. Check the cron-job.org Execution history for each.

Once confirmed:
1. Remove the `crons` array from `vercel.json` — they're double-firing today (Vercel + cron-job.org) and that's wasted compute
2. (Eventually) Pause/delete the Vercel project entirely — covered in Phase 9 of [`lean-mode.md`](lean-mode.md)

## Rollback

If cron-job.org has an outage or jobs misbehave:

```bash
# Remove all Nexus-prefixed jobs from cron-job.org
doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --delete-nexus

# Re-enable Vercel as the cron source — vercel.json hasn't changed, so Vercel
# Cron picks up where it left off on the next deployment / refresh
```

Vercel keeps cron schedules in its dashboard; just pushing a deploy revives them. No code change needed for rollback as long as `vercel.json`'s crons block is intact.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Script exits with `CRONJOB_ORG_API_KEY not set` | Missing env in Doppler | Add via the Setup section above |
| Per-job error `401` from `/api/cron/*` | `CRON_SECRET` in cron-job.org's header doesn't match Doppler's value | Rotate `CRON_SECRET`, re-run `--delete-nexus` + `--apply` |
| `5xx` from `/api/cron/*` | Bug in the route handler (not a cron problem) | Investigate the specific route's logs in Coolify |
| Jobs created but never fire | Free tier may have throttled past quota | Check cron-job.org dashboard for warnings; donate $5 for higher tier |
| Schedule parsed wrong | Conversion bug in `cronToSchedule()` | Compare the cron expression vs the arrays shown in `--dry-run` output |

## See also

- [`scripts/migrate-crons-to-cronjob-org.mjs`](../../scripts/migrate-crons-to-cronjob-org.mjs) — the migration tool
- [`vercel.json`](../../vercel.json) — source of truth for cron schedules (still here for rollback; remove after verification)
- [`docs/runbooks/lean-mode.md`](lean-mode.md) — full Vercel-to-Coolify transition plan
- [cron-job.org API docs](https://docs.cron-job.org/rest-api.html)
