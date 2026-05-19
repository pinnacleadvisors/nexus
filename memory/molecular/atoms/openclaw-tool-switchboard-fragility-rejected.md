---
type: atom
title: "OpenClaw tool-switchboard fragility (rejected)"
id: openclaw-tool-switchboard-fragility-rejected
created: 2026-05-19
links:
  - "[[openclaw]]"
  - "[[agent-framework-survey]]"
status: active
lastAccessed: 2026-05-19
accessCount: 0
---

# OpenClaw tool-switchboard fragility (rejected)

OpenClaw's multi-layered tool switchboard breaks on every framework update — tool ids drift, registrations stale, runtime errors surface in production. Rejected: Nexus uses a deterministic provider abstraction (lib/llm/provider.ts) with a flat LLM_PROVIDER env switch + Composio for OAuth tools, avoiding the dynamic-registry fragility entirely.

## Related
- [[openclaw]]
- [[agent-framework-survey]]
