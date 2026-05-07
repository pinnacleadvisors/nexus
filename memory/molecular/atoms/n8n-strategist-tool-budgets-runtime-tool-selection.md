---
type: atom
title: "n8n Strategist tool budgets — runtime tool selection"
id: n8n-strategist-tool-budgets-runtime-tool-selection
created: 2026-05-06
sources:
  - .claude/agents/n8n-strategist.md
status: active
lastAccessed: 2026-05-06
accessCount: 0
---

# n8n Strategist tool budgets — runtime tool selection

Every managed-agent dispatch carries an inputs.tools[] budget — at least 2 plausible tools the agent picks from at runtime. Dispatch route prepends 'Tool budget — pick the most appropriate' to the agent's brief. New tools light up across all workflows without regenerating any. Anti-pattern: tools: ['canva'] (single choice) collapses the design — Strategist enforces ≥2 options; lib/n8n/validate.ts warns on violations.
