---
type: atom
title: "Claude Gateway HMAC protocol matches dispatchToOpenClaw"
id: claude-gateway-hmac-protocol-matches-dispatchtoopenclaw
created: 2026-04-28
sources:
  - services/claude-gateway/src/auth.ts
links:
  - "[[claude-code-gateway]]"
status: active
lastAccessed: 2026-04-28
accessCount: 0
---

# Claude Gateway HMAC protocol matches dispatchToOpenClaw

POST /api/sessions/:sessionId/messages on the gateway requires three headers: Authorization: Bearer <CLAUDE_GATEWAY_BEARER>, X-Nexus-Signature: sha256=<hex of HMAC-SHA256(body, bearer)>, and X-Nexus-Timestamp: <ms-epoch>. Body shape: {role, content, agent, env}. Matches the protocol that lib/claw/business-client.ts + dispatchToOpenClaw already speak, so the gateway is a drop-in primary with OpenClaw as fallback. Bearer is shared between Doppler (Vercel side, CLAUDE_CODE_BEARER_TOKEN) and Coolify (gateway side, CLAUDE_GATEWAY_BEARER) — must be byte-identical.

## Related
- [[claude-code-gateway]]
