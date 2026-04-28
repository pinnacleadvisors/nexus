---
type: atom
title: "Claude Code Gateway is plan-billed via 20x Max"
id: claude-code-gateway-is-plan-billed-via-20x-max
created: 2026-04-28
sources:
  - services/claude-gateway/README.md
links:
  - "[[claude-code-gateway]]"
status: active
lastAccessed: 2026-04-28
accessCount: 0
---

# Claude Code Gateway is plan-billed via 20x Max

services/claude-gateway/ runs the claude CLI authenticated once via 'claude login' against the user's 20x Max plan; OAuth credentials persist in /root/.claude (mounted from a Coolify named volume) and survive container restarts. Every spawned session draws against the plan, not API credits.

## Related
- [[claude-code-gateway]]
