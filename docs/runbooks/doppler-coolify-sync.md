# Runbook — Doppler ⇄ Coolify env sync

**The model**: Doppler is the single source of truth for secrets. Each container runs `doppler run --` as its entrypoint, which fetches the latest secrets from Doppler at boot and injects them into `process.env`. Coolify never sees the secrets themselves — only the bootstrap `DOPPLER_TOKEN` needed to fetch them.

Trade-off: change a secret in Doppler → next container restart (manual redeploy in Coolify, or auto-redeploy hook) picks it up. No more per-container env-var hand-editing in Coolify UI.

## How it works

Each service's `Dockerfile` (or `Containerfile`) does two things:

1. Installs the Doppler CLI during build:
   ```dockerfile
   RUN curl -Ls --tlsv1.2 --proto "=https" --retry 3 \
        https://cli.doppler.com/install.sh | sh
   ```
2. Wraps the runtime command with `doppler run`:
   ```dockerfile
   ENTRYPOINT ["doppler", "run", "--fallback=/tmp/doppler.cache.json", "--", "./entrypoint.sh"]
   ```

At container start:
1. Container boots with one env var set: `DOPPLER_TOKEN=<service-token>`
2. `doppler run` reads `DOPPLER_TOKEN`, hits Doppler API, fetches all secrets in the config the token is scoped to
3. Doppler writes the cache file at `/tmp/doppler.cache.json` (for resilience)
4. Doppler exec's the real entrypoint with all fetched secrets as env vars
5. Application runs as normal — sees `CLAUDE_GATEWAY_BEARER`, `MEMORY_HQ_TOKEN`, etc. in `process.env`

If Doppler's API is unreachable on a later restart, the cache from the last successful pull is used so the container still boots (with whatever secrets were current at the last successful pull).

## One-time setup

### Step 1 — create a Doppler service token

1. Doppler UI → your project → Access → Service Tokens → Create
2. Scope: the Doppler config that holds all the production secrets (likely `production`)
3. Permissions: **Read only** — never give containers write access to Doppler
4. Copy the token value (`dp.st.production.<...>`)

Reuse the same token across all four services, or generate one per service for tighter scoping. Solo / lean mode: one token is fine.

### Step 2 — set DOPPLER_TOKEN on each Coolify app

For each app (`claude-gateway`, `codex-gateway`, `nexus-sandbox`, `nexus-app`):

- Coolify UI → app → Environment Variables → Add `DOPPLER_TOKEN` = `<service-token-value>` → Save
- Redeploy the app

That's the only manual env-vars step. Every other secret flows from Doppler automatically from now on.

### Step 3 — verify

After redeploying any one app, hit its `/health` endpoint (or check Coolify logs). The startup log should show the entrypoint script running with all expected env vars set. If you see `[entrypoint] CLAUDE_GATEWAY_BEARER missing` (or similar), the Doppler config doesn't have that secret — set it in Doppler UI and redeploy.

## Day-to-day workflow

**Rotate a secret**:
1. Update value in Doppler UI
2. Coolify UI → redeploy the affected app(s)
3. Container restarts, `doppler run` pulls the new value, app sees it

**Add a new secret to an existing service**:
1. Add it in Doppler with the right key (matching the var name the app reads)
2. Redeploy the service in Coolify
3. The service now sees the new var

**Add a new service**:
1. Add the service's Doppler config keys (same Doppler config — they all share)
2. Add a new Coolify app with the Dockerfile that has the Doppler CLI baked in (use any of the existing services as a template)
3. Set `DOPPLER_TOKEN` on the new app
4. Deploy

## Service-by-service status

| Service | Dockerfile/Containerfile | Compose env section | Vars from Doppler |
|---|---|---|---|
| `claude-gateway` | [services/claude-gateway/Dockerfile](../../services/claude-gateway/Dockerfile) | `DOPPLER_TOKEN` only | CLAUDE_GATEWAY_BEARER, COMPOSIO_API_KEY, MEMORY_HQ_TOKEN, SUPABASE_SERVICE_ROLE_KEY, etc. |
| `codex-gateway` | [services/codex-gateway/Dockerfile](../../services/codex-gateway/Dockerfile) | `DOPPLER_TOKEN` only | CODEX_GATEWAY_BEARER, CODEX_AUTH_JSON, etc. |
| `nexus-sandbox` | [services/nexus-sandbox/Containerfile](../../services/nexus-sandbox/Containerfile) | `DOPPLER_TOKEN` only | NEXUS_SANDBOX_TOKEN, SANDBOX_* tuning vars |
| `nexus-app` | [services/lean-deploy/Dockerfile](../../services/lean-deploy/Dockerfile) | `DOPPLER_TOKEN` only | Everything (Clerk, Supabase, gateway bearers, etc.) |

The full per-service var list lives in the comment block of each `docker-compose.yaml` `environment:` section.

## Failure modes + debugging

| Symptom | Likely cause | Fix |
|---|---|---|
| Container restart loop, log: `Doppler Error: failed to fetch secrets` | `DOPPLER_TOKEN` is wrong / missing / revoked | Verify token in Doppler UI → Service Tokens. Regenerate if needed. Update in Coolify and redeploy. |
| Container starts but app crashes with `CLAUDE_GATEWAY_BEARER is required` | Secret isn't in the Doppler config the token is scoped to | Add the secret in Doppler UI under the right config. Redeploy. |
| Container starts but uses STALE secrets | Doppler API was unreachable; container booted from `/tmp/doppler.cache.json` | Force a restart once Doppler is back online: Coolify UI → redeploy |
| `Doppler Error: TLS handshake timeout` | Container can't reach `api.doppler.com` (firewall, DNS) | Check egress config on the KVM. Doppler needs HTTPS out to its API |

Quick token check from inside a running container:
```bash
docker exec -it <coolify-container-name> doppler secrets --no-read-env --raw
# Should list all the secrets the token can see. If empty / errors, token is wrong.
```

## See also

- [`docs/runbooks/lean-mode.md`](lean-mode.md) — the LEAN_MODE flag (also one of the vars Doppler injects)
- [`docs/runbooks/migrate-to-lean-kvm.md`](migrate-to-lean-kvm.md) — the migration script now only PATCHes `DOPPLER_TOKEN` per app
- [Doppler CLI install — official docs](https://docs.doppler.com/docs/install-cli)
- [Doppler service tokens — official docs](https://docs.doppler.com/docs/service-tokens)
