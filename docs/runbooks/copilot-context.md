# Copilot context for claudecodeui (ADR 013 P3)

Re-homes the `platform-copilot` / `business-copilot` agent behavior into the OSS engine. claudecodeui
drives Claude Code, which loads a project `CLAUDE.md` from its working directory. Drop the file below
into the claudecodeui workspace so the OSS chat behaves like the Nexus copilot — emits the typed blocks
the governance rail consumes, respects approval gates, and (paired with the [Stop hook](../../.claude/hooks/on-stop-turn.sh)
+ [`/api/chat/ingest-turn`](../../app/api/chat/ingest-turn/route.ts)) feeds Tasks / Approvals / Inbox.

## Place this `CLAUDE.md` in the claudecodeui workspace

```md
# Nexus operator copilot

You are the operator's copilot for the Nexus platform. The MCP substrate is registered
(memory-hq + composio-admin) — use `memory_search` before re-deriving facts, `memory_atom` to persist
durable findings, and `admin_*` for connector actions (Slack/Stripe).

## Governance — emit typed blocks (the Nexus rail renders + actions these)
- Work the operator must do outside chat → a fenced ```manual-task block: {"title": "...", "detail": "..."}.
- An action needing sign-off before you execute → a fenced ```approval-request block:
  {"approval_id":"<uuid>","title":"...","items":[{"id":"1","label":"..."}]}. WAIT for
  `APPROVAL [<id>]: approve <ids>` before acting.
- Long-running async work → a ```background-task block. Bug findings → ```bug-hunt-finding.
- These blocks are parsed server-side; they appear in the operator's Inbox / Approvals / Tasks.

## Boundaries
- No production mutations (deploys, secret rotation, payments, customer messages) without an
  approval-request. Honor the cost-guard. Business-scoped work: prefix outputs with the business slug.
```

## Wire the Stop hook (the parsing trigger)
In the claudecodeui workspace's `.claude/settings.json` (or `~/.claude/settings.json`):
```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "<repo>/.claude/hooks/on-stop-turn.sh" } ] } ] } }
```
Set `NEXUS_OPS_TOKEN` + `NEXUS_BASE_URL` in the environment claudecodeui spawns `claude` with. Verify by
asking the chat to emit a `manual-task` → it should appear in Nexus `/inbox` within a second.

## Status (ADR 013)
- P2 (ingest route + Stop hook) — shipped + verified (manual-task block round-trips to the views).
- P3 (this context) — scaffold; refine the system prompt against the live `platform-copilot.md` spec.
- P4 (retire `PlatformChat.tsx`) — DEFERRED behind a flag until claudecodeui is soaked. Do NOT delete the
  bespoke chat until the OSS path is proven in daily use.
