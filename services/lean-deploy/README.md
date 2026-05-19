# lean-deploy — single-KVM Coolify stack for solo Nexus

The lean-mode topology: one Hostinger KVM with Coolify v4+ hosting **four
independent Coolify apps** on the same host, plus optional Ollama for free
local LLM experiments.

| Coolify app | Source path | Purpose |
|---|---|---|
| `nexus-app` | `services/lean-deploy/` (this dir) | Next.js platform UI + API |
| `claude-gateway` | `services/claude-gateway/` | Self-hosted Claude Code CLI gateway |
| `codex-gateway` | `services/codex-gateway/` | Codex CLI gateway (ChatGPT Pro / Plus) |
| `nexus-sandbox` | `services/nexus-sandbox/` | Rootless-Podman exec sandbox for skill-trainer |
| `ollama` (optional) | upstream `ollama/ollama` image | Local LLM fallback |

All apps attach to the shared external `coolify` network so a `cloudflared`
sidecar (configured outside Coolify) can resolve them by alias.

---

## Prerequisites

- Hostinger KVM (or any VPS) with ≥4 GB RAM, ≥2 vCPUs, ≥40 GB disk
- Coolify v4+ installed and reachable
- Cloudflare DNS managing your apex domain
- Doppler `production` config with the env vars below
- KVM tier confirmed to support rootless container nesting (verify with
  `podman info` after install — required for `nexus-sandbox`)

---

## One-time host setup

```bash
# On the KVM, as a non-root user with sudo
sudo apt-get update
sudo apt-get install -y podman uidmap slirp4netns fuse-overlayfs

# Verify rootless Podman works
podman info | grep -E 'rootless|graphDriverName'
# Expect: rootless=true, graphDriverName=overlay (or vfs as a fallback)
```

If `podman info` reports `rootless=false`, the VPS tier probably blocks user
namespaces. Either upgrade the plan or fall back to non-root Podman (security
trade-off — acceptable in lean mode since there's one tenant, but document it
in the manual checklist).

---

## Required environment variables

Set these as **shared variables** in Coolify (Project → Variables) so all four
apps inherit them. They're also documented in
[`memory/platform/SECRETS.md`](../../memory/platform/SECRETS.md).

| Var | Required by | Notes |
|---|---|---|
| `LEAN_MODE=1` | nexus-app | Flips feature flags. Always `1` here. |
| `LEAN_USER_DAILY_USD_LIMIT` | nexus-app | Global daily $ cap (default 5) |
| `LLM_PROVIDER` | nexus-app | `claude` (default), `mimo`, or `ollama` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | nexus-app | Clerk dashboard |
| `CLERK_SECRET_KEY` | nexus-app | Clerk dashboard |
| `ALLOWED_USER_IDS` | nexus-app | Your Clerk user id — owner gate |
| `NEXT_PUBLIC_SUPABASE_URL` | nexus-app | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | nexus-app | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | nexus-app | Supabase service-role key |
| `CLAUDE_CODE_GATEWAY_URL` | nexus-app | `http://claude-gateway:3000` (internal) |
| `CLAUDE_CODE_BEARER_TOKEN` | both | Shared bearer for nexus-app ↔ claude-gateway |
| `CLAUDE_GATEWAY_BEARER` | claude-gateway | Same value as above (named for the gateway side) |
| `CODEX_GATEWAY_URL` | nexus-app | `http://codex-gateway:3000` (internal) |
| `CODEX_GATEWAY_BEARER` | both | Shared bearer for nexus-app ↔ codex-gateway |
| `CODEX_AUTH_JSON` | codex-gateway | Paste your `~/.codex/auth.json` here |
| `NEXUS_SANDBOX_URL` | nexus-app | `http://nexus-sandbox:8080` (internal) |
| `NEXUS_SANDBOX_TOKEN` | both | Shared bearer for nexus-app ↔ nexus-sandbox |
| `MEMORY_HQ_TOKEN` | nexus-app, claude-gateway | GitHub PAT with `repo` scope on memory-hq |
| `COMPOSIO_API_KEY` | nexus-app, claude-gateway | Composio OAuth broker |
| `NEXUS_OPS_TOKEN` | nexus-app | Bearer for ops curl (provisioning, etc.) |
| `MIMO_API_KEY` | nexus-app | Optional (only when `LLM_PROVIDER=mimo`) |
| `OLLAMA_BASE_URL` | nexus-app | Optional (only when `LLM_PROVIDER=ollama`) |
| `STRIPE_WEBHOOK_SECRET` | nexus-app | Optional in lean mode |

---

## Deploy order

1. **Create the Coolify project** (e.g. `nexus-lean`).
2. Add all variables above as **shared environment variables**.
3. Create `claude-gateway` app — Compose at `services/claude-gateway/docker-compose.yaml`. Deploy.
4. Create `codex-gateway` app — Compose at `services/codex-gateway/docker-compose.yaml`. Deploy.
5. Create `nexus-sandbox` app — Compose at `services/nexus-sandbox/docker-compose.yaml`. Deploy.
6. Create `nexus-app` app — Compose at `services/lean-deploy/docker-compose.yaml`. Deploy.
7. (Optional) Add the `ollama/ollama` image as a Coolify app for local LLM
   smoke tests. Attach to the `coolify` network with alias `ollama`.

Order matters: `nexus-app` calls the gateways and sandbox at startup, so
they should be up first. If `nexus-app` starts before its dependencies the
healthchecks will retry until they come online — it just delays first-ready.

---

## DNS + ingress

Two options:

**Cloudflare Tunnel (recommended)** — run `cloudflared` as another Coolify
app attached to the same `coolify` network. Map:

```
nexus.<your-domain>      -> nexus-app:3000
claude-gw.<your-domain>  -> claude-gateway:3000  (optional, internal-only is fine)
codex-gw.<your-domain>   -> codex-gateway:3000   (optional, internal-only is fine)
```

Public ingress for `nexus-app` only — the gateways stay internal because
nexus-app reaches them by container alias on the shared network.

**Direct port + Cloudflare proxy** — open port 443 on the KVM, point an A
record at the host IP, Coolify auto-terminates TLS via its Traefik instance.

---

## Smoke test (after deploy)

```bash
# From your dev machine, with NEXUS_OPS_TOKEN exported
curl -s https://nexus.<your-domain>/api/health | jq .

# Lean-mode guard sanity check — should return ok:false in lean mode
curl -s -X POST https://nexus.<your-domain>/api/businesses/test/provision \
  -H "Authorization: Bearer $NEXUS_OPS_TOKEN" | jq .
# Expect: { "ok": false, "error": "Per-business provisioning disabled in lean mode", "mode": "lean" }

# Sandbox exec sanity check
curl -s -X POST https://nexus.<your-domain>/api/sandbox/exec \
  -H "Authorization: Bearer $NEXUS_OPS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"script": "echo hello-lean", "image": "alpine"}' | jq .
# Expect: { "ok": true, "stdout": "hello-lean\n", "exit_code": 0 }
```

If both pass, the lean stack is wired.

---

## Cost expectation

Single Hostinger KVM (4 GB / 2 vCPU / 80 GB SSD): ~$8-15/mo depending on
plan. Replaces:

- Vercel Pro hosting (~$20/mo)
- Second KVM for claude-gateway split (~$5-8/mo)
- Vercel-side observability add-ons (variable)

Plus: Claude Max + Codex Pro subscriptions stay (they're the LLM compute
themselves, not infra — see [task_plan-lean-mode.md](../../task_plan-lean-mode.md)).

---

## See also

- [`docs/runbooks/lean-mode.md`](../../docs/runbooks/lean-mode.md) — the LEAN_MODE flag itself
- [`docs/adr/006-lean-mode-pivot.md`](../../docs/adr/006-lean-mode-pivot.md) — decision record
- [`task_plan-lean-mode.md`](../../task_plan-lean-mode.md) — full pivot plan
