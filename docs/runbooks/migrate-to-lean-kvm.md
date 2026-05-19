# Runbook — migrate-to-lean-kvm

`scripts/migrate-to-lean-kvm.mjs` consolidates every Nexus service onto a single Coolify KVM (target). Today: KVM2 hosts `codex-gateway`; KVM4 hosts `claude-gateway` + per-business apps. Lean-mode target = everything on KVM4 (or any chosen single KVM).

## Prerequisites

### Target Coolify (KVM4) — required

| Env var | Source | Notes |
|---|---|---|
| `TARGET_COOLIFY_URL` *(or `COOLIFY_KVM4_URL`)* | Doppler | e.g. `https://coolify.coolifycloudtunnel.uk` |
| `TARGET_COOLIFY_TOKEN` *(or `COOLIFY_KVM4_API_TOKEN`)* | Doppler | Personal Access Token from Coolify → Keys & Tokens |
| `TARGET_COOLIFY_PROJECT_UUID` *(or `COOLIFY_PROJECT_ID_NEXUS_BUSINESSES`)* | Doppler | uuid of the project that holds the lean stack — create a `nexus-lean` project in Coolify UI if you want a clean separation from the per-business project |
| `TARGET_COOLIFY_SERVER_UUID` *(or `COOLIFY_KVM4_SERVER_UUID`)* | Doppler | uuid of the KVM4 server in Coolify |
| `GIT_REPOSITORY` | optional | Defaults to `https://github.com/pinnacleadvisors/nexus` |
| `GIT_BRANCH` | optional | Defaults to `main` |

### Source Coolify (KVM2) — only if you pass `--stop-source`

| Env var | Source |
|---|---|
| `SOURCE_COOLIFY_URL` | Doppler / KVM2's Coolify URL |
| `SOURCE_COOLIFY_TOKEN` | KVM2 Coolify PAT |

If KVM2's codex-gateway was deployed bare-Docker (no Coolify) you can skip the source flag and SSH-stop it manually after the cutover.

### Per-service envs

Each service's compose file references env vars (e.g. `${CLAUDE_GATEWAY_BEARER}`). The script collects these references from the compose body and bulk-sets them on the new Coolify app using whatever's in `process.env`. Run via Doppler so they're all injected:

```bash
doppler run -- node scripts/migrate-to-lean-kvm.mjs --dry-run
```

Missing values surface in the dry-run output — fix in Doppler before applying.

### Git source registered in Coolify (one-time)

Coolify needs a "Private Git Source" registered for `pinnacleadvisors/nexus`:

1. Coolify UI → Sources → New Source → GitHub App (or Public if the repo is public)
2. Connect the GitHub App; grant repo access
3. The script doesn't need the source UUID — Coolify resolves the repo by URL — but the UI auth has to exist or builds fail with "repository not accessible"

If the repo is private (which it should be), you must use the GitHub App flow. Personal Access Token doesn't work for builds in Coolify v4.

## Usage

### Step 1 — dry-run

```bash
doppler run -- node scripts/migrate-to-lean-kvm.mjs --dry-run
```

Expected output: per-service breakdown of what would happen, including which env vars are missing. Nothing changes on Coolify.

### Step 2 — apply (no source stop)

Once the dry-run is clean:

```bash
doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply
```

This creates apps + deploys on the target. The source KVM2 keeps running until you explicitly stop it. Useful for parallel-run validation: hit both, compare behaviour, only stop the source when confident.

### Step 3 — apply + stop source (cutover)

After confirming the target apps are healthy:

```bash
doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply --stop-source
```

Stops (never deletes) matching apps on the source. To roll back: start them again from KVM2's Coolify UI.

### Targeting one service

```bash
doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply --service=codex-gateway
```

Useful for retrying a single failed service without re-running the others.

## What gets created on the target

Per service:
1. Coolify Application (Compose, git-based) with `name = <service>`
2. Bulk-PATCH of every env the compose file references and that's set in your local env
3. POST `/applications/{uuid}/deploy` to trigger the initial build + run
4. Polling on `/applications/{uuid}` until `status` contains "running" (5-min timeout)

Idempotent — re-runs detect existing apps by name and skip create.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `403 — repository not accessible` | Coolify's GitHub App lacks access to `pinnacleadvisors/nexus` | Install / re-authorise the Coolify GitHub App; grant repo access |
| `coolify POST /applications/dockercompose → 422` | Required field missing or invalid | Check the script output's `body:` line — Coolify returns field-level errors. Common: `project_uuid` for the wrong server, `server_uuid` for the wrong project |
| Env var present in compose but listed as "missing" | Not set in Doppler | Add it to the appropriate Doppler config and re-run |
| Status stuck at "starting" past 5min | Long build (first deploy of nexus-app is the slowest — `npm ci` + Next.js build) | Wait it out in the Coolify UI, OR re-run the script — it'll detect the app exists and skip create, but won't re-poll. Use Coolify UI for monitoring large builds |
| `--stop-source` finds nothing | KVM2 deployed bare-Docker, not via Coolify | SSH to KVM2 and `docker compose -f services/codex-gateway/docker-compose.yaml down` manually after the target is healthy |

## Order of operations (recommended)

1. Register the GitHub App with Coolify (one-time)
2. Create a `nexus-lean` project in Coolify UI; copy its UUID into `TARGET_COOLIFY_PROJECT_UUID`
3. Verify target server UUID — `curl $TARGET_COOLIFY_URL/api/v1/servers -H "Authorization: Bearer $TARGET_COOLIFY_TOKEN" | jq '.[].uuid'`
4. Set all required env vars in the Doppler config you'll be running against
5. `--dry-run` until missing-env list is empty
6. `--apply` (without `--stop-source`) — parallel-run validation
7. Smoke tests from [`docs/runbooks/lean-mode.md`](lean-mode.md#smoke-tests)
8. `--apply --stop-source` once confident
9. Wait 7 days for rollback confidence, then delete the stopped source apps via the UI

## See also

- [`scripts/migrate-to-lean-kvm.mjs`](../../scripts/migrate-to-lean-kvm.mjs) — the script itself
- [`docs/runbooks/lean-mode.md`](lean-mode.md) — full lean-mode runbook including post-cutover steps
- [`services/lean-deploy/README.md`](../../services/lean-deploy/README.md) — what the four target apps do
- [`docs/adr/006-lean-mode-pivot.md`](../adr/006-lean-mode-pivot.md) — decision record
