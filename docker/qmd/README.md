# QMD sidecar — local hybrid search over molecular memory

Wraps [tobi/qmd](https://github.com/tobi/qmd) as a Docker service so Nexus can
do BM25 + vector + LLM-rerank search over `memory/molecular/` without burning
hosted-API credits. Runs on the same Hostinger / Coolify box as the OpenClaw
fleet.

## Architecture

```
┌────────────────┐       hybrid search         ┌──────────────┐
│  Nexus (Vercel)│ ─────────────────────────▶  │ Cloudflare   │
│ /api/molecular │                             │ Tunnel +     │
│ /search        │ ◀───────────────────────── │ Access policy │
└────────────────┘                             └──────┬───────┘
                                                      │
                                              ┌───────▼─────────┐
                                              │  QMD container  │
                                              │  /mcp (HTTP)    │
                                              │  /health        │
                                              └───────┬─────────┘
                                                      │
                                              ┌───────▼──────────┐
                                              │ memory/molecular │
                                              │ (cloned at boot) │
                                              └──────────────────┘
```

QMD has **no built-in authentication** — keep the container bound to localhost
on the host (`127.0.0.1:8181`) and front it with a Cloudflare Tunnel + Access
policy (or any reverse proxy that requires `Authorization: Bearer …`).

## First-time deploy

1. **Generate a GitHub PAT** with `repo:read` scope (if the Nexus repo is
   private). Store it as `MEMORY_REPO` in the form
   `https://x-access-token:<pat>@github.com/pinnacleadvisors/nexus.git`.
2. **Coolify → New Resource → Application → Docker Compose** → paste
   `coolify.yaml`. Point the build context at this `docker/qmd/` directory.
3. **Set environment** in Coolify's UI:
   - `MEMORY_REPO` (required)
   - `MEMORY_BRANCH` (default `main`)
   - `COLLECTION_GLOB` (default `memory/molecular/**/*.md`)
4. **Deploy.** First boot takes ~15 min — three GGUF models (~2 GB) download
   into the named `qmd-data` volume.
5. **Cloudflare Tunnel** → add a public hostname `qmd.<your-domain>` →
   `http://localhost:8181`. Lock it behind an Access policy that allows your
   own email + a service token for the Vercel app.
6. **Nexus side**: in Doppler, set
   - `QMD_BASE_URL=https://qmd.<your-domain>`
   - `QMD_BEARER_TOKEN=<cloudflare-access-service-token>`
   - `QMD_ENABLED=1`

`lib/molecular/qmd-client.ts` reads those three env vars and short-circuits when
`QMD_ENABLED` is unset, so flipping the toggle is the safe rollout.

## Refreshing the index

The container clones the repo on every restart and re-runs `qmd update + embed`
unless `QMD_REINDEX_ON_BOOT=0`. To force a refresh on demand without a redeploy:

```bash
# from the host
docker exec -it nexus-qmd qmd update
docker exec -it nexus-qmd qmd embed
```

For an automated nightly refresh, schedule a `docker restart nexus-qmd` cron in
Coolify (Resource → Scheduled Tasks).

## Sizing

| Profile          | Approx RAM | Disk for cache | Notes                                |
|------------------|-----------:|---------------:|--------------------------------------|
| Hot embed only   | 1.5 GB     | 600 MB         | Skip rerank model — set `QMD_NO_RERANK=1` (planned) |
| Embed + rerank   | 3 GB       | 1.4 GB         | Default                              |
| Full pipeline    | 4–5 GB     | 2.2 GB         | Embed + rerank + query expansion     |

A KVM 4 (16 GB) on Hostinger comfortably runs both the OpenClaw fleet and QMD.

## Troubleshooting

- `[qmd] MEMORY_REPO is required` — set the env var in Coolify.
- `permission denied on .cache/qmd/models` — ensure the `qmd-data` volume is
  owned by uid 1000 (the `qmd` user inside the container).
- `[qmd] memory/molecular missing in cloned repo` — likely cloned the wrong
  branch or token doesn't have repo scope. Verify with `docker exec -it
  nexus-qmd ls /data/repo/memory`.
- First query after boot returns `503` for ~15 min — models still downloading.
  Check `docker logs nexus-qmd` for `Loaded model …` lines.

## Migration to Fly.io

When the Hostinger box can't keep up:

```bash
fly launch --copy-config --no-deploy --name nexus-qmd ./docker/qmd
fly volumes create qmd_data --region <pop> --size 10
fly secrets set MEMORY_REPO=... MEMORY_BRANCH=main
fly deploy
```

Add `[mounts] source="qmd_data" destination="/data"` to `fly.toml`.
