---
type: atom
title: "Cloudflare Tunnel orphan-hostname trap"
id: cloudflare-tunnel-orphan-hostname-trap
created: 2026-04-28
sources:
  - services/claude-gateway/README.md
links:
  - "[[cloudflare-tunnel]]"
status: active
lastAccessed: 2026-04-28
accessCount: 0
---

# Cloudflare Tunnel orphan-hostname trap

If multiple tunnels exist in a Cloudflare account, adding a Public Hostname to a tunnel that is not the one currently running in cloudflared causes Cloudflare's edge to return error 1033 — DNS sees the CNAME, but the tunnel has no live connector. Always cross-check the tunnelID in 'docker logs cloudflared' (line 'Starting tunnel tunnelID=...') against the dashboard tunnel hosting the hostname.

## Related
- [[cloudflare-tunnel]]
