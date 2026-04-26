# OpenClaw container template

Per-business OpenClaw instance for the Nexus multi-business fleet (Pillar D in `task_plan.md`).

## What this is

A container image that runs one OpenClaw gateway with an isolated workspace, identity files, and bearer token. Spin up N copies = N business AIs, each addressable by Nexus per a `business_secrets` row (see `lib/claw/business-client.ts`).

## Files

- `Dockerfile` — node:22-bookworm-slim + openclaw + tmux + git, runs as non-root `claw` user.
- `entrypoint.sh` — renders the `workspace-template/*.md` files with envsubst on first boot, inits a git repo, then starts OpenClaw bound to loopback.
- `workspace-template/{SOUL,IDENTITY,MEMORY,AGENTS}.md` — Felixcraft-style identity + memory + workspace rules templated with `${BUSINESS_*}` placeholders.
- `coolify.yaml` — Coolify Docker Compose template; one stack per business.

## Deploy on Hostinger Coolify

1. Provision a Hostinger KVM 4 (4 GB / 2 vCPU), install Coolify v4.
2. Create a Cloudflare Tunnel; route `*.claw.<your-domain>` at the host.
3. In Coolify: New Resource → Docker Compose → paste `coolify.yaml`; build context = `docker/openclaw/`.
4. Per business, set the env vars in Coolify's UI:
   - `BUSINESS_NAME` (e.g. `Felix`)
   - `BUSINESS_ROLE` (e.g. `PDF Author + Storefront Operator`)
   - `BUSINESS_VOICE`, `BUSINESS_BOUNDARIES`, `OPERATOR_NAME`, `TRUSTED_CHANNEL` (defaults reasonable)
   - `ANTHROPIC_API_KEY` (single key shared across businesses for now)
   - `OPENCLAW_BEARER_TOKEN` (random 32-byte hex; will be stored encrypted in Nexus's `user_secrets`)
5. Attach the tunnel hostname `<biz-slug>.claw.<your-domain>` → service `openclaw:18789`.
6. In Nexus, register the business: `POST /api/claw/business { slug, gatewayUrl, bearerToken }` (route to be added in a follow-up commit).

## Migration to Fly.io

When a business outgrows shared compute, copy the workspace volume:

```bash
docker run --rm -v <biz>-workspace:/src -v $(pwd):/dst alpine tar czf /dst/<biz>.tgz -C /src .
fly volumes create <biz>_workspace --region <region>
fly deploy -e BUSINESS_NAME=... -e ANTHROPIC_API_KEY=... -e OPENCLAW_BEARER_TOKEN=...
fly ssh console -C 'tar xzf - -C /workspace' < <biz>.tgz
```

Bearer + URL update in Nexus: `UPDATE user_secrets SET value=encrypt('<new-fly-url>') WHERE kind='business:<slug>' AND name='gatewayUrl';`

## Security

- Gateway binds to loopback only inside the container. Cloudflare Tunnel is the sole ingress.
- Bearer token never written to disk; injected via env at start.
- Workspace runs as non-root `claw` user.
- Anthropic key shared across containers (cost-isolated by `business_slug` in `token_events`, see migration 019).
