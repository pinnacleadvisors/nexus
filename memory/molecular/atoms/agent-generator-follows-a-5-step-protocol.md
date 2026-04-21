---
type: atom
title: "Agent generator follows a 5-step protocol"
id: agent-generator-follows-a-5-step-protocol
created: 2026-04-21
sources:
  - file://docs/agents/GENERATION_PROTOCOL.md
links:
  - "[[agent-generator-agent]]"
---

# Agent generator follows a 5-step protocol

The agent-generator emits (1) a .claude/agents/<slug>.md spec, (2) a Supabase agent_library row, (3) molecular memory entity + atom, (4) updated SECRETS.md if env vars are new, and (5) runs the transferability checklist before returning.

## Related
- [[agent-generator-agent]]
