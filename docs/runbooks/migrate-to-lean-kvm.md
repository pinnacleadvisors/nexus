# Runbook — migrate-to-lean-kvm

`scripts/migrate-to-lean-kvm.mjs` consolidates every Nexus service onto a single Coolify KVM (target). Today: KVM2 hosts `codex-gateway`; KVM4 hosts `claude-gateway` + per-business apps. Lean-mode target = everything on KVM4 (or any chosen single KVM).

## Prerequisites

### Target Coolify (KVM4) — required

All four target env vars are the established Nexus names — already in Doppler from the per-business provisioning work. No new vars to set.

| Env var | Notes |
|---|---|
| `COOLIFY_KVM4_URL` | e.g. `https://coolify.coolifycloudtunnel.uk` |
| `COOLIFY_KVM4_API_TOKEN` | Personal Access Token from Coolify → Keys & Tokens |
| `COOLIFY_PROJECT_ID_NEXUS_BUSINESSES` | uuid of the Coolify project that holds the lean stack (historical name — same project hosts the per-business apps + the new lean-mode apps; if you want them separated, create a new project and point this at the new uuid) |
| `COOLIFY_KVM4_SERVER_UUID` | uuid of the KVM4 server in Coolify |
| `GIT_REPOSITORY` (optional) | Defaults to `https://github.com/pinnacleadvisors/nexus` |
| `GIT_BRANCH` (optional) | Defaults to `main` |

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

Coolify needs a Git Source registered for `pinnacleadvisors/nexus`:

1. Coolify UI → Sources → New Source
   - **Public Repository** (current — works while the repo is public)
   - **GitHub App** (switch to this once the repo is private; grant repo access)
2. The script targets `POST /applications/public` and passes `git_repository` + `git_branch` — Coolify resolves against the registered Public Source automatically.
3. When the repo flips to private: change the endpoint in `scripts/migrate-to-lean-kvm.mjs` from `/applications/public` to `/applications/private-github-app` and add the field `github_app_uuid: <uuid>` from the Sources page. Inline comment in the script flags this.

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
| `coolify POST /applications/public → 422` | Required field missing or invalid | Check the script output's `body:` line — Coolify returns field-level errors. Common: `project_uuid` for the wrong server, `server_uuid` for the wrong project. The endpoint is `/applications/public` for public repos + Docker Compose builds; `/applications/dockercompose` is **deprecated** and accepts only inline base64 Compose, not git-cloned builds — don't switch back to it. |
| `coolify POST /applications/public → 401` | Token missing repo access | The GitHub App / Public Source linked in Coolify UI doesn't have access to the repo. Re-authorise via Coolify → Sources |
| Service shows `already on target  status=<not running:healthy>` | App was created but never deployed cleanly, runtime crashed, or first deploy was triggered with missing env vars | The migration script intentionally won't redeploy existing apps. Either trigger a manual redeploy from Coolify UI, or `curl -X GET '<url>/api/v1/deploy?uuid=<uuid>&force=true' -H "Authorization: Bearer $COOLIFY_KVM4_API_TOKEN"` — the script prints this exact command in the hint line. Inspect logs in Coolify UI to find the root cause (usually missing env vars or build failure) |
| `coolify POST /applications/{uuid}/deploy → 404` | Wrong deploy endpoint | Coolify v4's deploy endpoint is **top-level**: `GET /api/v1/deploy?uuid={uuid}` (or `POST /api/v1/deploy` with `{uuid, force}` body) — NOT nested under `/applications/`. Already fixed in the migration script; mentioned here as a forensic note in case anyone copies the curl out of an old log |
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
