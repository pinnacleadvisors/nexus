---
title: claude-gateway services folder exists
created: 2026-05-02
links:
  - mocs/claude-code-gateway
---

# claude-gateway services folder exists

`services/claude-gateway/` is the self-hosted Claude Code instance, deployed via Coolify on Hostinger KVM2. Drains the user's 20× Max plan instead of API credits. Bearer + HMAC verification on inbound (matches `CLAUDE_CODE_BEARER_TOKEN`). Defence-in-depth via `ALLOWED_USER_IDS` mirroring (every signed POST must carry `X-Nexus-User-Id` matching). `task_plan-claude-gateway.md` documents deploy. Sister service `services/codex-gateway/` (ADR 002) handles execution-heavy work via ChatGPT Pro.

Source: `services/claude-gateway/`, `task_plan-claude-gateway.md`, `docs/adr/002-codex-gateway-sandbox.md`.
