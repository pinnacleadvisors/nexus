---
type: atom
title: "n8n workflow self-test debug loop"
id: n8n-workflow-self-test-debug-loop
created: 2026-05-06
sources:
  - lib/n8n/validate.ts
status: active
lastAccessed: 2026-05-06
accessCount: 0
---

# n8n workflow self-test debug loop

lib/n8n/validate.ts performs structural validation (node shape, unique names, connection targets, ≥1 trigger, dispatch nodes carrying ≥2-tool budget). lib/n8n/finalize.ts gates the AI-parsed workflow through this validator before live n8n write. POST /api/n8n/debug runs a single n8n-debugger pass — the agent uses n8n MCP (get_node, validate_node, validate_workflow) to look up canonical schemas and patch nodes. Cap 3 internal iterations. Beyond that, file a Board card for human review.
