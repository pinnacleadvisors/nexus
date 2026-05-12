# @nexus/mcp-composio-admin

Hard-isolation MCP wrapper around Composio for the platform-copilot agent.

## Why this exists

The vanilla [`@composio/rube-mcp`](https://www.npmjs.com/package/@composio/rube-mcp) exposes **every** Composio connection the configured API key can see — Admin + Shared + per-business (PR #151's three-scope model). The platform-copilot is supposed to use Admin scope only, but rube-mcp has no native way to filter — leaving us with soft-isolation via the agent spec (PR #152).

This wrapper makes the isolation **structural**. At startup it reads the operator's `business_slug='_admin'` rows from `connected_accounts` and the MCP tools it exposes can only route to those accounts. The agent literally cannot reach a Shared or per-business token through this server.

## How it differs from rube-mcp

| Aspect | `@composio/rube-mcp` | `@nexus/mcp-composio-admin` (this) |
|---|---|---|
| Account discovery | All accounts the API key can see | Only `business_slug='_admin'` rows |
| Tool surface | One MCP tool per Composio action per account (500+ tools) | 3 universal tools: list-platforms, list-actions, execute |
| Scope filtering | None — relies on agent self-discipline | Server-side gate; non-admin platforms get a clear error |
| Caller can override `connected_account_id` | Yes (implicit per tool) | No — resolved server-side from the admin-scope row |

The 3-tool surface is a trade-off: less tool discoverability for the agent, but airtight isolation. The agent uses `admin_list_actions(platform)` to introspect what's available.

## Required env

| Var | Purpose |
|-----|---------|
| `COMPOSIO_API_KEY` | Talks to Composio's REST API (`/api/v3/tools/execute/{slug}`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL — used to query `connected_accounts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for the RLS-bypassing read |
| `NEXUS_OPERATOR_USER_ID` | Clerk user_id whose admin scope to load. Defaults to the first `ALLOWED_USER_IDS` entry when unset (single-user mode) |
| `COMPOSIO_API_URL` | Optional override (default `https://backend.composio.dev`) |

## Tools exposed

### `admin_list_connected_platforms()`

Returns the list of platforms connected in Admin scope, with last-used metadata. Call this BEFORE composing a tool call to confirm what's available.

### `admin_list_actions(platform: string)`

Returns the Composio action slugs available for a platform's toolkit. Forwards to Composio's `/api/v3/tools?toolkit=<SLUG>` endpoint. Errors with a clear message if the platform isn't in admin scope.

### `admin_execute_action(platform: string, action: string, args?: object)`

Executes the named Composio action against the admin-scope `connected_account_id`. The caller cannot specify the account_id — it's resolved server-side, which is the entire isolation guarantee.

## Reload-on-change

Admin-scope account list is loaded once at startup. If the operator connects a new platform in Admin scope, redeploy the gateway (Coolify → Redeploy claude-gateway) for the wrapper to see it. A future enhancement could refresh periodically or via a tool call.

## Register with Claude Code

This wrapper replaces `@composio/rube-mcp` in `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "composio-admin": {
      "command": "node",
      "args": ["/opt/mcp-composio-admin/dist/index.js"],
      "env": {
        "COMPOSIO_API_KEY":           "...",
        "NEXT_PUBLIC_SUPABASE_URL":   "...",
        "SUPABASE_SERVICE_ROLE_KEY":  "...",
        "NEXUS_OPERATOR_USER_ID":     "user_..."
      }
    }
  }
}
```

The shared `services/claude-gateway/entrypoint.sh` writes this file at boot — see that script for the canonical wiring.

## Build + run locally

```bash
cd services/mcp-composio-admin
npm install
npm run build
NEXUS_OPERATOR_USER_ID=user_xxx COMPOSIO_API_KEY=... \
  NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node dist/index.js
# Server starts on stdio. Useful for manual MCP protocol tests.
```
