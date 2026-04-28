---
type: entity
subtype: concept
title: "Cloudflare Tunnel"
id: cloudflare-tunnel
created: 2026-04-28
---

# Cloudflare Tunnel

Outbound-only ingress from cloudflared to a Cloudflare edge POP; replaces port forwarding. Public Hostnames must be configured on the tunnel that's actually running in the cloudflared container (not an orphaned tunnel) — otherwise edge returns 1033.
