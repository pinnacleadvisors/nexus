# Nexus local OS — Mac-mini host

Runs the full Nexus stack on the operator's Mac mini under **OrbStack + plain
docker-compose**, replacing the Hostinger KVM4 / Coolify host. Supabase stays
cloud (durable source of truth). Public traffic arrives via the dedicated
Cloudflare Tunnel `nexus-mac`. See [`task_plan-local-os-migration.md`](../../task_plan-local-os-migration.md).

## Services (one compose)

| Service | Port (loopback) | Role |
|---|---|---|
| `nexus-app` | 3000 | Next.js platform (bound `0.0.0.0`) |
| `claude-gateway` | 3001 | Claude Code CLI gateway |
| `codex-gateway` | 3002 | Codex CLI gateway |
| `nexus-sandbox` | — | rootless-Podman exec (internal alias only) |
| `cloudflared` | — | `nexus-mac` tunnel connector |
| `cron-runner` | — | supercronic firing `/api/cron/*` (replaces cron-job.org) |

> n8n + qa-runner stay on KVM4. firecrawl was already broken pre-migration.

## Secrets

One secret on disk: `services/local-os/.env` → `DOPPLER_TOKEN` (a service token
for `nexus/prd`). Every container self-fetches the rest via `doppler run --`.
Mint a replacement: `doppler configs tokens create local-os-mac-mini -p nexus -c prd --plain`.

## Operate the stack

```bash
cd /Users/dylan_mini/Dev/nexus
set -a; . services/local-os/.env; set +a            # load DOPPLER_TOKEN

# bring up / down (compose path is long — alias it if you like)
C="docker compose -f services/local-os/docker-compose.yaml --env-file services/local-os/.env"
$C up -d --build         # build + start everything
$C ps                    # status
$C logs -f nexus-app     # tail a service
$C restart cron-runner   # after editing crons.json
```

Autostart at login is handled by OrbStack (`app.start_at_login=true`) + the
LaunchAgent `com.nexus.local-os` (→ `startup.sh`). Containers carry
`restart: unless-stopped`.

## Manage crons (agent-friendly)

Crons run **locally** now (no cron-job.org). The control surface is
[`cron/crons.json`](cron/crons.json) — a flat list of `{path, schedule, enabled}`.

```bash
# 1. edit cron/crons.json  (flip `enabled`, change `schedule`, add a job)
# 2. apply:
$C restart cron-runner
# 3. watch them fire (every hit logs its HTTP code):
$C logs -f cron-runner
```

- `schedule` is standard 5-field cron, **UTC** (matches the old Vercel/cron-job.org semantics).
- Jobs hit the **internal** app URL `http://nexus-app:3000` (no tunnel hop). Set a
  per-job `"target"` to override (e.g. an external service).
- 9 jobs are enabled (the set that was live on cron-job.org at cutover); 10 more
  are declared-but-disabled — flip `enabled` to activate. `platform-dev-tick`
  dispatches autonomous dev work — enable deliberately.

## Tunnel / DNS

`nexus`, `claude-gw`, `codex-gw` CNAMEs point at the `nexus-mac` tunnel
(`b741e21c…`). Rollback to KVM4 = repoint them to `61285ea4…` (snapshot in
`cloudflared/.rollback.json`). Edit ingress in `cloudflared/config.yml` then
`$C restart cloudflared`.

## Rollback (whole platform → KVM4)

KVM4 stays up as fallback until decommissioned. To revert: repoint the 3 CNAMEs
to `61285ea4.cfargotunnel.com` and re-create the cron-job.org jobs
(`doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --apply`).
