# task_plan-chat.md — chat surfaces for platform-copilot + per-business agents

Canonical plan for the in-Nexus chat surfaces. Consolidates the phasing that has lived in PR descriptions and code comments since PR #145. New phases land here first; PRs reference the phase number.

## North Star

```
Goal:             Operator-facing chat UIs for both per-business agents and
                  platform-copilot. Multi-turn, persistent, with approval
                  gates on destructive actions. Streaming progressive output.
                  Codex delegation visible inline. Hard-isolated MCP per scope.
Success criteria: - Operator can open multiple persistent chats with the
                    platform-copilot; chats survive page reloads + server
                    restarts; old chats can be reopened or deleted.
                  - Destructive actions surface as inline approval cards
                    with per-item checkboxes; no destructive action runs
                    without explicit operator click.
                  - Streaming tool-call output renders inline as collapsible
                    cards; codex delegations include full transcript.
                  - Per-business chat surface (one chat per business) routes
                    to the per-business gateway and uses business-scope
                    connections.
                  - Cost-guard kill switch + per-session caps prevent
                    runaway spend.
Hard constraints: - Owner-only (proxy.ts ALLOWED_USER_IDS already gates).
                  - business_slug is the partition key on all chat tables.
                  - Composio MCP isolation is structural — platform-copilot
                    uses admin-scope only, per-business agents use shared +
                    per-business via the existing fallback chain.
                  - Cancel button required before any unbounded agent loop
                    can ship.
```

> **Operator rollout guide** — after merging a new chat-phase PR, follow [`docs/runbooks/chat-phases-rollout.md`](docs/runbooks/chat-phases-rollout.md) for the click-by-click Coolify + Vercel verification flow.

## Phase status

| Phase | Scope | Status | Ship PR(s) |
|---|---|---|---|
| **1** | MVP chat shell — single conversation, sync dispatch, markdown rendering | ✅ Shipped | #145, #146, #149, #150 |
| **1b** | Async job protocol — kill the 55s timeout via enqueue + poll | ✅ Shipped | #155 |
| **3** | Approval cards — server-side sentinel parsing + inline UI buttons | ✅ Shipped | #156 |
| **4** | Persistence — `chat_sessions` + `chat_messages` tables, sidebar, multi-chat, delete | ✅ Shipped | #157, #159 |
| **8** | MCP pre-approval — gateway entrypoint writes `permissions.allow` for required MCP tools | ✅ Shipped | #160 |
| **6** | Cancel button — bail out of in-flight poll loop | ✅ Shipped | #161 |
| **5a** | Per-business chat MVP — `/businesses/<slug>/chat` route, business-scope system prompt | ✅ Shipped | #162 |
| **2b** | Tool-call cards — inline collapsible cards showing MCP tool name + input/output | ✅ Shipped | #163 |
| **2a** | Poll-with-deltas — partial assistant text rendered as tentative bubble between polls | ✅ Shipped | #164 |
| **5b** | Per-business chat full parity — sidebar / multi-chat / delete / tool cards / streaming | ✅ Shipped | #165 |
| **2c** | Codex delegation — first-class `delegate_to_codex` MCP tool, full transcript inline | ✅ Shipped | #166 |
| **7** | Browser smoke tests — Playwright + Chromium on codex-gateway + `nexus-smoke` helper | ⏳ This PR | (next) |

## Phase 3 — Approval cards (this PR)

### Protocol
Agent emits a fenced code block tagged `approval-request` to surface an approval gate. Example:

````
```approval-request
{
  "title": "Open PR for the gateway-status comment",
  "approval_id": "auth-refactor-2026-05-13-001",
  "items": [
    { "id": "1", "label": "Create branch feat/platform-copilot/gateway-status-comment", "approved_by_default": true },
    { "id": "2", "label": "Edit app/api/gateway-status/route.ts (add header comment)", "approved_by_default": true },
    { "id": "3", "label": "Open PR via GITHUB_CREATE_A_PULL_REQUEST", "approved_by_default": true }
  ]
}
```
````

The poll route extracts these blocks and exposes them as structured data on the API response. The client renders each as an `<ApprovalCard>` with per-item checkboxes + Approve / Deny buttons. On click, a follow-up user message is auto-sent in this format:

```
APPROVAL [auth-refactor-2026-05-13-001]: approve 1,3 (skip 2)
```

The agent reads this in its next turn and proceeds with the approved subset.

### Files (this PR adds)
- `lib/chat/approval.ts` — parser for `approval-request` fenced blocks, builder for `APPROVAL [...]` reply strings
- `components/platform-chat/ApprovalCard.tsx` — inline UI

### Trust model
- Buttons are NOT executable code — they just write a follow-up text message that the agent interprets
- Server-side enforcement: the agent spec already states "ALWAYS ask before destructive actions"; the protocol just makes the asking interactive

## Phase 4 — Persistence + multi-chat + delete (this PR)

### Schema (migration 036)

```sql
chat_sessions(
  id            uuid primary key,
  user_id       text not null,         -- Clerk user_id
  scope         text not null,         -- 'platform' (today) | 'business:<slug>' (future Phase 5)
  agent_slug    text not null default 'platform-copilot',
  title         text,                  -- auto from first user message; editable later
  created_at    timestamptz default now(),
  last_message_at timestamptz default now()
)
chat_messages(
  id          uuid primary key,
  session_id  uuid references chat_sessions(id) on delete cascade,
  role        text check (role in ('user','assistant','system')),
  content     text not null,
  metadata    jsonb default '{}',      -- approval_id, tool_calls, durationMs, etc.
  created_at  timestamptz default now()
)
```

Both tables RLS-enabled — only service-role can read/write. Client never reads these directly; goes through API routes.

### New API routes
- `GET    /api/platform-chat/sessions`               — list current user's sessions (newest first)
- `POST   /api/platform-chat/sessions`               — create + return `{id, title}`
- `DELETE /api/platform-chat/sessions/[id]`          — delete (cascades to messages)
- `GET    /api/platform-chat/sessions/[id]/messages` — load history
- `POST   /api/platform-chat`                        — existing, now accepts `sessionId` and persists user + assistant messages

### UI
- `<SessionSidebar>` — list past sessions, "+ New chat" button, hover-to-show delete icon, current-session highlighted
- `<PlatformChat>` — accepts `sessionId` prop; on mount loads message history from API; on send persists via the POST

## Phase 2a (deferred) — SSE streaming

Switch `/api/platform-chat` to use `callGatewayStream` (already in `lib/claw/gateway-call.ts`). Emit SSE events `delta` / `tool_call` / `tool_result` / `done`. Client uses `EventSource` instead of poll-loop.

Replaces the 2.5s poll with token-level streaming. Big UX win for long agent runs but bigger code change. Defer until Phase 3+4 baked.

## Phase 5 (deferred) — Per-business chat

Mirror the platform-copilot chat at `/businesses/<slug>/chat`. Differences:
- System prompt scoped to business via `buildBusinessSystemPrompt(slug, userId)`
- Dispatches to per-business gateway (via existing `resolveClawConfig`)
- Composio MCP via business-scope (uses fallback chain to NULL)
- `chat_sessions.scope = 'business:<slug>'`
- Session sidebar grouped by business

## Phase 6 (deferred) — Cancel button

Adds a `DELETE /api/platform-chat/jobs/[jobId]` route that calls the gateway's job-cancel endpoint. UI shows an X next to the Thinking indicator.

## Phase 7 (deferred) — Browser smoke tests via codex

Install Playwright on codex-gateway. Add `delegate_to_codex_smoke({preview_url, scenarios})` tool. Platform-copilot calls it after pushing a feature branch to verify the preview deploy works before requesting merge approval.

## Why this lives at the repo root

Per `CLAUDE.md`'s long-horizon task protocol, multi-session plans live in `task_plan-<topic>.md` files at the repo root. This file is the source of truth for what's shipped, what's in flight, and what's deferred. Update the status column on every PR merge.
