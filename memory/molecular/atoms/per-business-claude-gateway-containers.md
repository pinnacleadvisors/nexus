---
type: atom
title: "Per-business Claude gateway containers"
id: per-business-claude-gateway-containers
created: 2026-05-06
sources:
  - docs/runbooks/per-business-container-rollout.md
status: active
lastAccessed: 2026-05-06
accessCount: 0
---

# Per-business Claude gateway containers

Each business gets its own Coolify Docker container running the Claude Code gateway. The container has the business's MCP set baked in (resolved from lib/businesses/mcp-manifest.ts by niche/money_model) and Composio connected-account IDs scoped to that business. Provisioning: POST /api/businesses/:slug/provision creates the Coolify app via lib/coolify/client.ts and persists business:<slug> gateway secrets so resolveClawConfig() picks up the new container. Idle scale-down via /api/cron/scale-down-businesses every 30 min (idle > 1h).
