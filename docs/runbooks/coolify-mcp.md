# Coolify MCP — operator runbook

Lets the platform-copilot make changes to the operator's Coolify v4 instance (read state, redeploy after merges, restart wedged containers, mutate env vars) without the operator manually clicking in the Coolify dashboard. Built in PR #191.

## What's safe vs gated

| Tool | Type | Gate |
|---|---|---|
| `coolify_list_apps` | read | pre-approved |
| `coolify_get_app` | read | pre-approved |
| `coolify_get_logs` | read | pre-approved (log content sanitised for injection markers) |
| `coolify_list_env_keys` | read | pre-approved (returns NAMES only) |
| `coolify_get_env_value` | sensitive read | agent proposes via `approval-request` block |
| `coolify_redeploy` | write | approval-request required |
| `coolify_restart` | write | approval-request required |
| `coolify_start` | write | approval-request required |
| `coolify_stop` | write | approval-request + `PROTECTED_UUIDS` check |
| `coolify_set_env` | write | approval-request, value redacted in audit |
| `coolify_delete_env` | write | approval-request |

Three structural guards apply BEFORE every call:

1. **Kill switch** — single-row `coolify_kill_switch` table. Flipped to `revoked` from `/settings/accounts → Coolify → Disconnect`. MCP polls on every call; refuses immediately when revoked.
2. **Rate limit** — max 5 writes/min, 30 writes/hour per user. Reads don't count. Overage logs `result='rate_limited'` to `coolify_audit_log`.
3. **Protected UUIDs** — `PROTECTED_UUIDS` env (comma-separated CSV) lists uuids the agent CANNOT modify. Should include the claude-gateway + codex-gateway + any self-hosted Supabase. Set in Doppler.

## First-time setup

### Step 1 — apply migration

In Supabase SQL Editor → New query → paste `supabase/migrations/042_coolify_audit.sql` → Run. Verify with:

```sql
select count(*) from coolify_audit_log;   -- 0
select status from coolify_kill_switch;   -- 'active'
```

### Step 2 — set `PROTECTED_UUIDS` in Doppler

Open Coolify dashboard → find the UUIDs of:
- `claude-gateway` (the chat surface — agent MUST NOT stop this)
- `codex-gateway` (KVM2 — same reason)
- Any other "do not touch" containers (self-hosted Supabase, prod databases, etc.)

Paste comma-separated into Doppler:

```
PROTECTED_UUIDS=abcd-1234-...,efgh-5678-...,ijkl-9012-...
```

The MCP refuses any **write** against these uuids with `result='protected_uuid'`.

### Step 3 — redeploy claude-gateway

In Coolify on KVM4 → `claude-gateway` → **Redeploy**. Boot log should show:

```
[gateway] Building coolify MCP from /repo/services/mcp-coolify...
[gateway] coolify MCP built — will register.
[gateway] Wrote MCP config: composio-admin memory-hq codex-delegate permission-broker coolify
```

If `coolify` is missing from the registered list, scroll up for `WARNING: coolify MCP build FAILED` + the underlying error. Common causes: `COOLIFY_KVM4_URL` or `COOLIFY_KVM4_API_TOKEN` unset in the gateway env (those are passed in via Doppler).

### Step 4 — smoke test

In `/manage-platform` chat:

```
Operator: List my Coolify apps.
Agent:    [calls coolify_list_apps] — returns a tool-call card with the list.
Operator: Get logs for codex-gateway, last 100 lines.
Agent:    [calls coolify_get_logs] — tool-call card with sanitised logs.
```

Then test a gated write:

```
Operator: Restart codex-gateway — it's wedged.
Agent:    [emits approval-request block: "Restart codex-gateway (uuid: ...)"]
Operator: [clicks Approve in the FloatingActionBar]
Agent:    [calls coolify_restart] — tool-call card with response.
```

Open `/settings/accounts` (Default scope) — Coolify panel at the bottom should show the activity feed with these calls.

### Step 5 — test the kill switch

Click **Disconnect** in the panel. Next agent call should fail with `kill_switch` result. Click **Re-enable** to restore.

## When to use Coolify tools vs `approval-request` vs file edits

| Operator says... | Right tool |
|---|---|
| "What's running on KVM4?" | `coolify_list_apps` |
| "Why is codex-gateway slow?" | `coolify_get_logs` → analyse → propose fix |
| "I merged the docs PR — push it" | `coolify_redeploy` (after approval-request) |
| "Restart the wedged container" | `coolify_restart` (after approval-request) |
| "The env var X is wrong" | `coolify_set_env` (after approval-request showing OLD vs NEW value plan) |
| "Fix the actual bug" | propose code-fix PR (via existing GitHub flow); Coolify is for ops, not code |

## When things go wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| MCP not registered at boot | `COOLIFY_KVM4_*` env unset in gateway | Confirm Doppler → claude-gateway service has the same Coolify env that the provisioner uses |
| Every call returns `kill_switch` | Operator hit Disconnect (or migration not applied → fail-safe deny) | Click Re-enable in `/settings/accounts`; or apply migration 042 |
| Write returns `protected_uuid` | Target uuid is in `PROTECTED_UUIDS` | Right behavior. If genuinely needed, edit in Coolify directly. |
| Write returns `rate_limited` | Agent (or operator) hit 5/min or 30/hour | Wait it out or check audit feed for unexpected activity |
| Agent stops being able to read | Token rotation in Coolify | Regenerate token in Coolify Settings → API Tokens, update Doppler, redeploy gateway |

## Threat-model assumptions

- Coolify token has full scope (`/api/v1/*`). We rely on the MCP's allow-list of tool names to bound what the agent can do — there's no Coolify-side scope token (Coolify v4 doesn't expose one as of 2026-05).
- The agent is bounded by:
  1. The 12 tool definitions (no other endpoint is callable)
  2. `PROTECTED_UUIDS` blocklist on writes
  3. Rate limits
  4. Kill switch
  5. Audit log (no silent action — even denied calls leave a row)
- Compromise of the gateway container would leak the Coolify token. Mitigation: rotate the token + redeploy gateway. Same posture as any other token in the gateway env.

## Future improvements

- Auto-kill on suspicious patterns (>3 stops in 5 min on different uuids → revoke). Add as a cron that watches `coolify_audit_log`.
- Slack alert on every write for the first month of rollout. Add a webhook the audit insert fires through.
- Scoped Coolify tokens if upstream adds them (Coolify v5?). Would let us mint a token with only "list apps + view logs" for read-only periods.
