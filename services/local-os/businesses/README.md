# Per-business containers — Mac local-OS (OrbStack)

Per-business Claude-gateway containers run here, on the same `coolify` docker
network as the rest of the [local-OS stack](../README.md). This replaces the
Coolify-on-KVM4 hosting model (ADR 011 made the Mac primary; this brings the
per-business containers along).

> **Topology:** see [AGENTS.md → Topology](../../../AGENTS.md#topology). Business
> containers moved KVM4(Coolify) → Mac(OrbStack) on 2026-06-04.

## Why this is simpler than the Coolify model

| Concern | Coolify (old) | local-OS (now) |
|---|---|---|
| App → gateway reach | public FQDN over the internet (app was on Vercel) | **internal docker DNS** `http://nexus-business-<slug>:3000` — app is on the same `coolify` network |
| Public DNS / tunnel | one Cloudflare ingress + DNS route per business | **none needed** (optional, see below) |
| Secrets | 12 env vars pasted into Coolify per business | **DOPPLER_TOKEN + per-business bearer/slug** — the rest from Doppler `prd` |
| Provisioning | remote HTTP call to the Coolify API | host-side `npm run business:local` |
| Idle scale-down | a cron that stops cloud containers to bound cost | **not needed** — the Mac is always-on; idle containers are ~free |
| Auth | `claude login` in the container terminal | **non-interactive** via Doppler `CLAUDE_CODE_OAUTH_TOKEN` |

## Files

- `<slug>.env` — gitignored. `DOPPLER_TOKEN` (copied from `../.env`) +
  `NEXUS_BUSINESS_SLUG` + `CLAUDE_GATEWAY_BEARER` (generated) + `MCP_PROFILE`.
- `docker-compose.yaml` — generated from the `*.env` files. Gitignored
  (reproducible via `sync`). One service per business, alias
  `nexus-business-<slug>`, `restart: unless-stopped`, joined to `coolify`.

The image is `nexus-business:<slug>`, built locally for arm64 from
[`services/claude-gateway/Dockerfile.business`](../../claude-gateway/Dockerfile.business).

## Operator commands

```bash
# Add a business: resolve its MCP manifest, build the arm64 image, generate
# <slug>.env (new bearer), regenerate the compose file, and bring it up.
npm run business:local -- add inkbound            # niche auto-resolved from seeds
npm run business:local -- add acme --niche=saas   # explicit profile

# Lifecycle
npm run business:local -- list                    # what's defined + running
npm run business:local -- up   inkbound
npm run business:local -- down inkbound
npm run business:local -- rebuild inkbound         # rebuild image + recreate

# Print the gateway secret to store for dispatch routing (gatewayUrl + bearer).
# This is what nexus-app reads from user_secrets(kind=business:<slug>) to route
# dispatches. Writing it to prod is a separate, gated step (see Cutover below).
npm run business:local -- secret inkbound
```

`add` / `sync` regenerate `docker-compose.yaml` to match the set of `*.env`
files, so adding/removing a business is just managing its `.env`.

## Cutover for a business currently on Coolify

1. `npm run business:local -- add <slug>` — builds + runs the local container.
2. Smoke-test it locally:
   `docker exec local-os-businesses-nexus-business-<slug>-1 curl -fsS localhost:3000/health`
   (or from the app container: `curl http://nexus-business-<slug>:3000/health`).
3. **GATED — prod write.** Point dispatch at the local container by updating the
   `business:<slug>` gateway secret. `secret <slug>` prints the exact
   `gatewayUrl` (`http://nexus-business-<slug>:3000`) + bearer. Store via the
   normal user-secrets path (operator-approved). Reversible via
   `BUSINESS_GATEWAY_BYPASS_SLUGS` / `DISABLE_PER_BUSINESS_GATEWAY`.
4. Run a low-stakes dispatch; confirm logs resolve to `business:<slug>`.
5. **GATED — teardown.** After bake-in, delete the Coolify `nexus-business-<slug>`
   app (it's already idle/exited).

## Optional: public hostname

Internal DNS is enough for the app→gateway path. If you ever need a business
gateway reachable from outside (e.g. a webhook), add one ingress line to
[`../cloudflared/config.yml`](../cloudflared/config.yml):

```yaml
  - hostname: <slug>-gw.coolifycloudtunnel.uk
    service: http://nexus-business-<slug>:3000
```

then `docker compose -f ../docker-compose.yaml restart cloudflared` and add the
DNS route. Not done by default.
