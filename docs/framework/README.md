# Agent Framework — model-agnostic protocols

This directory contains the cross-model framework that every AI agent in this org follows. It is **not** Claude-specific. Any model — Claude, GPT-4, Gemini, Llama, future models — can adopt these protocols to get the same quality, token efficiency, and reliability properties.

## Why a framework?

When multiple AI models work in the same org, divergent conventions create chaos:
- One agent writes facts in JSON, another in YAML — graph queries break
- One model splits long writes, another doesn't — random stream timeouts
- One agent stamps provenance, another doesn't — auditability lost
- One agent's "long-horizon plan" looks nothing like another's — no interoperability

The framework gives every model the same **principles**. Implementation details (tool names, hook syntax, CLI commands) live in per-model adapters under `ADAPTERS/`.

## Files

- **`AGENT-FRAMEWORK.md`** — the canonical, model-agnostic principles. Read this first. Five sections: memory architecture, long-horizon task protocol, output discipline, memory-hq protocol, multi-model collaboration.
- **`ADAPTERS/CLAUDE-CODE.md`** — Claude Code overlay. Maps the universal principles onto Claude Code's tool surface (Write/Edit/Bash, hooks, `~/.claude/CLAUDE.md`, MCP servers).
- **`ADAPTERS/`** — future overlays (OpenAI Assistants, Cursor, Continue, custom agents).

## How to consume

**For a new model/agent integration:**
1. Read `AGENT-FRAMEWORK.md` end-to-end.
2. If an adapter exists for your model, read it next.
3. If no adapter exists, write one: copy `ADAPTERS/CLAUDE-CODE.md` and replace the Claude-specific bits with your model's equivalents. Submit a PR.

**For a Claude Code device:**
- Pull the latest framework: `node cli.mjs --backend=github framework-pull`
- Copy the assembled doc into `~/.claude/CLAUDE.md`

**For an OpenAI / generic agent:**
- Fetch via the GitHub Contents API (read-only, public to your token)
- Or `curl https://raw.githubusercontent.com/pinnacleadvisors/memory-hq/main/framework/AGENT-FRAMEWORK.md` (with bearer)

## Updating

Source of truth lives in `pinnacleadvisors/nexus` at `docs/framework/`. Edits there flow into `pinnacleadvisors/memory-hq/framework/` via the bootstrap script (re-run on changes). Devices then `framework-pull` to sync.

If you have to choose between updating the principle (in `AGENT-FRAMEWORK.md`) or the adapter (in `ADAPTERS/<model>.md`), default to the adapter — keep principles stable.
