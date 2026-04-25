# 001 — Composio→Doppler secrets broker for Claude Code web

- **Date:** 2026-04-25
- **Status:** Accepted

## Context

Claude Code on the web runs in ephemeral cloud sandboxes that need access to
Nexus's Doppler-managed secrets (Anthropic key, Supabase service role, Tavily,
Firecrawl, etc.) to do real work. Three options were considered:

1. **Doppler service token baked into the sandbox.** Simple, but no
   per-user attribution, no audit trail, no easy revocation, and the token
   sits next to the agent for the full session.
2. **Composio MCP server wired directly into the session.** Lowest friction
   in code, but every agent in the session inherits the full Composio
   toolkit, which is the wrong blast radius for "the agent only ever needs
   to read N specific secret names".
3. **A Next.js API route that brokers Composio→Doppler reads, called once
   at session start by a hook.** Composio handles the OAuth dance to
   Doppler; the route is the single audit boundary; the agent never sees
   Composio creds, never sees secrets it didn't ask for.

## Decision

Adopted **option 3** as the default for Claude Code web cloud sessions.

Components:

- `lib/composio.ts` — fetch-based Composio client with `fetchDopplerSecrets(names)`.
  No SDK dependency; calls Composio's `/api/v3/actions/{action}/execute`
  endpoint against a pre-connected Doppler account.
- `app/api/composio/doppler/route.ts` — POST broker. Auth is either Clerk
  session + `ALLOWED_USER_IDS` (interactive owner use) **or** a bearer token
  matching `CLAUDE_SESSION_BROKER_TOKEN` (cloud sandbox use). Requested
  secret names are filtered against `COMPOSIO_BROKER_ALLOWED_SECRETS`. Every
  call writes an `audit_log` row; values are never logged.
- `.claude/hooks/session-start-secrets.sh` — eval-able shell script that
  POSTs the allowlist, parses the JSON response, and emits
  `export NAME='value'` lines on stdout. No-ops cleanly when broker config
  is unset so local sessions are unaffected.

A second layer (`.claude/agents/doppler-broker.md`) handles **mid-session**
secret-gated actions on top of the same broker route. The parent agent
invokes it via `Task(subagent_type="doppler-broker")` with a `secret` name
+ a `command` to run; the broker fetches the secret, exports it to its own
shell, runs the command, and returns the output with the secret value
scrubbed. The parent never sees the value. The bearer token lives only in
the doppler-broker agent's tool scope.

## Consequences

**Easier:**
- Single audit/scope boundary for every Doppler read from a sandbox.
- Allowlist is declarative — adding a new secret means adding a name to
  `COMPOSIO_BROKER_ALLOWED_SECRETS`, not changing code.
- Bearer token lives only in the cloud sandbox env; rotation is one
  `doppler secrets set` away.

**Harder / requires care:**
- The bearer token is the bootstrap secret — if it leaks, an attacker can
  pull every secret on the allowlist. Mitigations: short-lived sandboxes,
  tight allowlist, rate limit, periodic rotation.
- The doppler-broker agent must scrub secret values out of any returned
  output. The agent spec enforces this; if the parent passes
  `scrub:false`, that's an explicit acknowledgement of leakage.
- Composio is now a hard dependency for the cloud workflow. If Composio
  is down, sandboxes start without secrets and the agent fails fast (the
  hook logs to stderr but does not block the session).

## Revisit when

- We move off Composio (e.g. self-hosted OAuth proxy).
- We need per-user-attributed secret access (multi-tenant Nexus).
- The bearer token model becomes inadequate (e.g. we want short-lived,
  user-scoped JWTs minted by `/api/claude-session/dispatch` instead of a
  shared static token).
