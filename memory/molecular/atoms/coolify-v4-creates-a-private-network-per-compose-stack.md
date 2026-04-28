---
type: atom
title: "Coolify v4 creates a private network per Compose stack"
id: coolify-v4-creates-a-private-network-per-compose-stack
created: 2026-04-28
sources:
  - services/claude-gateway/docker-compose.yaml
links:
  - "[[coolify]]"
  - "[[claude-code-gateway]]"
status: active
lastAccessed: 2026-04-28
accessCount: 0
---

# Coolify v4 creates a private network per Compose stack

In Coolify v4 beta.474, every Docker Compose service is launched on its own auto-generated bridge network (named after the service ID). To reach it from another stack (e.g. cloudflared), the service must explicitly attach to a shared external network. The compose snippet 'networks: { default: {}, coolify: { aliases: [stable-name] } }' plus 'networks: { coolify: { external: true } }' makes the membership permanent across redeploys.

## Related
- [[coolify]]
- [[claude-code-gateway]]
