# task_plan — Migrate per-business containers Coolify(KVM4) → Mac local-OS (OrbStack)

Goal: Run per-business Claude-gateway containers on the Mac mini under OrbStack/docker-compose instead of Coolify on KVM4, and migrate the one existing business (`inkbound`).
Success criteria:
- A per-business container builds + runs locally on the `coolify` docker network, reachable internally at `http://nexus-business-<slug>:3000`.
- `nexus-app` (same network) dispatches to it via the stored `business:<slug>` gateway secret — no public tunnel/DNS needed.
- `inkbound` runs locally, healthy, authenticated (non-interactive via Doppler `CLAUDE_CODE_OAUTH_TOKEN`).
- Per-business containers follow the DOPPLER_TOKEN-only rule (AGENTS.md) — only a tiny per-business `.env` (slug + bearer) is host-local.
- Repeatable: one operator command spins up the next business locally.
Hard constraints:
- Don't break the running local-os stack (nexus-app/claude-gateway/codex-gateway/cron/cloudflared).
- No prod secret writes, no Coolify teardown, no DNS publish without explicit operator approval (gated).
- Provider-agnostic; pass pre-commit guards (tsc, check:operator-commands, check:topology, etc.).

## Key design decisions
1. **Internal DNS, not public tunnel.** App is now local on the same `coolify` network → gatewayUrl = `http://nexus-business-<slug>:3000`. The Coolify model needed a public FQDN only because the app was remote (Vercel). Eliminates DNS + the per-business cloudflared ingress (kept optional/documented).
2. **DOPPLER_TOKEN-only containers.** `Dockerfile.business` rewrapped to match the base gateway: install Doppler CLI, `ENTRYPOINT ["doppler","run","--fallback=...","--","./entrypoint.sh"]`. The 8 global API keys (Composio/Firecrawl/Memory-HQ/n8n/Tavily/…) come from Doppler `prd`; only the per-business bearer + slug + profile live in a gitignored `services/local-os/businesses/<slug>.env`.
3. **No idle scale-down locally.** Scale-down existed to bound Coolify/cloud cost. The Mac is always-on; idle containers cost ~nothing. `restart: unless-stopped` keeps them up; the scale-down cron short-circuits for local runtime.
4. **Host-side provisioning.** Coolify provisioning was an HTTP API call from a remote app. Locally the app container has no docker socket, so per-business provisioning is a host-side operator script (`scripts/local-os-business.ts`) — consistent with how the rest of local-os is managed (compose commands on the box).

## Progress (as of 2026-06-04)
### Live state discovered
- Exactly ONE per-business container on Coolify/KVM4: `nexus-business-inkbound` (uuid k1thj2tszj9vnff6qbv6yhv0, status `exited:unhealthy`, image ghcr.io/pinnacleadvisors/nexus-business:inkbound). Not running → migrating it disrupts nothing live.
- inkbound profile resolves to `digital-products`. Pilot built with `mcp_override=none` (per runbook) — MCP works at runtime via the cloned /repo + npx, so MCP_PACKAGES="" is correct.
- Doppler prd has CLAUDE_CODE_OAUTH_TOKEN → non-interactive auth (no `claude login`).

### Completed
- [x] Task 1 — Dockerfile.business Doppler-wrapped (DOPPLER_TOKEN-only, matches base gateway).
- [x] Task 2 — services/local-os/businesses/ scaffold (.gitignore, README).
- [x] Task 3 — scripts/local-os-business.ts generator (add/up/down/rebuild/sync/list/secret) + `npm run business:local`.
- [x] Task 4 — scale-down cron short-circuits when BUSINESS_RUNTIME=local.
- [x] Task 5 — inkbound image built (arm64, 1.09GB), container UP + healthy. `/health`→{ok:true,loggedIn:true}; auth non-interactive via CLAUDE_CODE_OAUTH_TOKEN; MCPs registered (composio-admin, memory-hq, codex-delegate, permission-broker, coolify); reachable from nexus-app at http://nexus-business-inkbound:3000.
- [x] Task 6 — docs: AGENTS.md Topology, operator-commands TL;DR, both Coolify runbooks banner. (memory-hq atom: pending post-cutover.)
- guards: tsc + retry-storm/sentry/lockfile/topology/agent-spec/provider-agnostic/cron-route/codeql/operator-commands/agents-md-import all PASS. (lint step has a pre-existing minimatch tooling crash, unrelated.)

### Remaining (GATED — operator approval, irreversible/prod)
- [ ] Task 7a — write business:inkbound gatewayUrl=http://nexus-business-inkbound:3000 + new bearer to prod user_secrets (`secret inkbound` prints them). Routes dispatch to the local container. Reversible via BUSINESS_GATEWAY_BYPASS_SLUGS.
- [ ] Task 7b — set Doppler BUSINESS_RUNTIME=local (prd) so scale-down cron no-ops.
- [ ] Task 7c — after bake-in, delete the dead Coolify nexus-business-inkbound app (uuid k1thj2tszj9vnff6qbv6yhv0, already exited).
- [ ] Task 7d — write the post-infra-change memory-hq atom (after cutover verified).

### Blockers / Open Questions
- inkbound was `exited` on Coolify (not serving), so nothing live is disrupted; the local container is a strict improvement once the secret points at it.
