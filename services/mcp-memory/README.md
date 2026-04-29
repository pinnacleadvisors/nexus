# @nexus/mcp-memory

MCP server that exposes the central `memory-hq` graph as native tools to **any** Claude Code session — Nexus, sibling repos, your laptop, a CI runner, anywhere.

Wraps the platform's HTTP surface:
- Writes go through `POST /api/memory/event` (provenance + rate-limit + scope validation).
- Reads go through `GET /api/memory/query` (Supabase mirror, no GitHub rate limit).

## Why use this vs the CLI?

| Path | When |
|------|------|
| `services/mcp-memory` (this) | Any Claude Code session — tools appear natively (`memory_atom`, `memory_search` …). No bash boilerplate per agent. |
| `cli.mjs --backend=github` | Shell scripts, CI jobs, ad-hoc one-off writes. |
| Direct `/api/memory/event` curl | Non-Claude writers (n8n, OpenClaw, external webhooks). |

All three converge on the same endpoint, so atoms written from any path show up in the same graph with full provenance.

## Tools exposed

- `memory_atom` — write an atomic fact (one fact per atom)
- `memory_entity` — write a person / company / concept
- `memory_moc` — write/update a Map of Content
- `memory_query` — slug + frontmatter filter against the Supabase mirror
- `memory_search` — full-text search across atoms

## Install

From this repo:

```bash
cd services/mcp-memory
npm install
npm run build
```

## Register with Claude Code (per-user)

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "memory-hq": {
      "command": "node",
      "args": ["/absolute/path/to/services/mcp-memory/dist/index.js"],
      "env": {
        "NEXUS_BASE_URL": "https://nexus.your-domain.com",
        "MEMORY_HQ_TOKEN": "ghp_..."
      }
    }
  }
}
```

Restart Claude Code. The tools appear under the `memory-hq` namespace.

## Required env

| Var | Purpose |
|---|---|
| `NEXUS_BASE_URL` | Base URL of your Nexus deployment (e.g. `https://nexus.example.com`). The server hits `<base>/api/memory/event` and `/api/memory/query`. |
| `MEMORY_HQ_TOKEN` | Same bearer token as `/api/memory/event`. Stored only on the machine that runs the MCP server — never in any repo. |

## Smoke test

Manual stdio test:

```bash
NEXUS_BASE_URL=https://nexus.example.com MEMORY_HQ_TOKEN=ghp_... node dist/index.js
```

The server reads JSON-RPC requests on stdin. Send `{"jsonrpc":"2.0","method":"tools/list","id":1}` and confirm the response lists all five tools.
