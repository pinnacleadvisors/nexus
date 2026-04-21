---
type: atom
title: "Agent library markdown is the source of truth"
id: agent-library-markdown-is-the-source-of-truth
created: 2026-04-21
sources:
  - file://docs/agents/GENERATION_PROTOCOL.md
links:
  - "[[agent-generator-agent]]"
  - "[[firecrawl-agent]]"
  - "[[supermemory-agent]]"
  - "[[workflow-optimizer-agent]]"
---

# Agent library markdown is the source of truth

Claude managed agents live as markdown files at .claude/agents/<slug>.md; Supabase agent_library is a projection. If Supabase is unreachable the file still defines the agent.

## Related
- [[agent-generator-agent]]
- [[firecrawl-agent]]
- [[supermemory-agent]]
- [[workflow-optimizer-agent]]
