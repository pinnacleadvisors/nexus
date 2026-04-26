---
type: atom
title: "Manual — ANTHROPIC_API_KEY required for /tools/agents"
id: manual-anthropic-api-key
created: 2026-04-26
sources:
  - ROADMAP.md#L175
links:
  - "[[manual-steps]]"
  - "[[phase-10-agent-capabilities]]"
---

# Manual — ANTHROPIC_API_KEY

✅ Done. Required for `/tools/agents` to function. Get key at https://console.anthropic.com → API Keys → Create Key. Without this key the agents page returns a 503 with a clear error message. Optional: set `OPENCLAW_GATEWAY_URL` + `OPENCLAW_BEARER_TOKEN` to route agent runs through OpenClaw (Claude Pro subscription) instead of direct API.

## Related
- [[manual-steps]]
- [[phase-10-agent-capabilities]]
