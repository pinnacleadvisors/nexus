---
title: n8n strategist swarm mode flag
created: 2026-05-02
links:
  - mocs/business-operator
---

# n8n Strategist swarm mode flag

When the strategist decomposes an idea step into ≥3 independent sub-tasks ("build a full site", "launch across landing+video+ad+email") it sets `swarm: true` on the dispatch node. `/api/claude-session/dispatch` then injects `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` into the session env so the lead agent can spawn a team with a shared task list. Single-agent steps stay in normal mode. Review nodes are placed only after asset-producing steps (website / image / video / ad / landing / email / blog / product listing) plus a final launch gate — the old "every 3 steps" cadence is gone.

Source: `AGENTS.md` n8n Strategist section, `app/api/claude-session/dispatch/route.ts`.
