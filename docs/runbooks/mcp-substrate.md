# MCP Substrate — the shared collaboration backbone

Canonical reference for the **single-sources-of-truth that every agent shares over MCP**, per
[ADR 012](../adr/012-lean-nexus-integration-cockpit.md). Any agent — Claude Code, opencode, Hermes,
Paperclip workers — registers these same endpoints and thereby collaborates over shared memory +
connectors. This is the lean-Nexus collaboration backbone (the same idea as Doppler for secrets).

| Concern | Source of truth | MCP server | Tools |
|---|---|---|---|
| **Secrets** | Doppler | (CLI: `doppler run --`) | n/a |
| **Memory** | `memory-hq` (Supabase `mol_*` mirror) | [`services/mcp-memory`](../../services/mcp-memory) | `memory_atom`, `memory_entity`, `memory_moc`, `memory_query`, `memory_search`, `memory_walk`, `ecosystem_invoke` |
| **Connectors** | Composio (`connected_accounts` `_admin` scope) | [`services/mcp-composio-admin`](../../services/mcp-composio-admin) | `admin_list_connected_platforms`, `admin_list_actions`, `admin_execute_action` |

Both are **stdio MCP servers** (`node dist/index.js`). They are NOT separate containers — agents
spawn them as child processes. Secrets are injected at launch via `doppler run` (nothing hardcoded).

## Build (once, on the host)

```bash
cd services/mcp-memory          && npm install && npm run build   # already built
cd ../mcp-composio-admin        && npm install && npm run build
```

## Register — Claude Code (user-level, `~/.claude/settings.json`)

User-level registration means **every** `claude` session inherits the substrate — including the
**Paperclip `adapter-claude-local` workers** (they spawn `claude`, which reads `~/.claude`). Add both
under `mcpServers` (the `doppler run` wrapper keeps secrets out of the file):

```jsonc
{
  "mcpServers": {
    "memory-hq": {
      "command": "/opt/homebrew/bin/doppler",
      "args": ["run","--project","nexus","--config","dev","--silent","--",
               "/Users/<you>/.nvm/versions/node/<ver>/bin/node",
               "/Users/<you>/Dev/nexus/services/mcp-memory/dist/index.js"]
    },
    "composio-admin": {
      "command": "/opt/homebrew/bin/doppler",
      "args": ["run","--project","nexus","--config","prd","--silent","--",
               "/Users/<you>/.nvm/versions/node/<ver>/bin/node",
               "/Users/<you>/Dev/nexus/services/mcp-composio-admin/dist/index.js"]
    }
  }
}
```

> `composio-admin` uses the **prd** config (that's where `COMPOSIO_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
> and the `_admin` connected accounts live). It loads `NEXUS_OPERATOR_USER_ID`, falling back to
> `ALLOWED_USER_IDS[0]`. Verify: `claude mcp list` → both ✓; the server logs e.g.
> `Loaded N admin-scope account(s): slack, stripe`.

## Register — opencode

opencode supports MCP servers in its config (`~/.config/opencode/opencode.json` or project `opencode.json`):

```jsonc
{ "mcp": {
    "memory-hq":      { "type": "local", "command": ["doppler","run","--project","nexus","--config","dev","--silent","--","node","<repo>/services/mcp-memory/dist/index.js"] },
    "composio-admin": { "type": "local", "command": ["doppler","run","--project","nexus","--config","prd","--silent","--","node","<repo>/services/mcp-composio-admin/dist/index.js"] }
} }
```

## Register — Hermes / generic stdio MCP client

Hermes (and any MCP-capable runtime) registers a stdio server by command. Point it at the same
`doppler run -- node dist/index.js` invocation. Hermes config: `hermes config set` / its `cli-config.yaml`
MCP section. For runtimes that only speak HTTP MCP, front the stdio server with an MCP stdio→HTTP bridge
(e.g. `mcp-proxy`) — not needed for Claude Code / opencode (both speak stdio natively).

## Why this is the substrate
- **Provenance + scoping** are enforced server-side: `mcp-composio-admin` resolves the
  `connected_account_id` from the `_admin` row — a caller CANNOT reach a per-business token through it.
  `mcp-memory` stamps `frontmatter.author` per the writer identity.
- **One place to rotate / extend.** Add a connector in Composio → every agent sees it. Add a memory
  atom from any agent → every agent can `memory_search` it.
- **Paperclip workers inherit it for free** (user-level Claude Code registration), so the workforce-lab
  agents share Nexus's memory + connectors with zero per-agent wiring.

## Verify
```bash
claude mcp list                                   # both servers ✓
# memory:  ask any claude session to call memory_search "<term>"
# connectors: admin_list_connected_platforms -> ["slack","stripe", ...]
```
