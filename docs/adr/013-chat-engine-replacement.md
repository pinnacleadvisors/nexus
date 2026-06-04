# 013 — Chat engine replacement: decouple engine from governance

- **Date:** 2026-06-04
- **Status:** Accepted

## Context

`components/platform-chat/PlatformChat.tsx` (~2000 lines) conflates two separable things:
- **The chat ENGINE** — streaming, tool-call rendering, session sidebar, poll/SSE loops, message bubbles.
- **The Nexus GOVERNANCE views** — the typed fenced blocks (`approval-request`, `manual-task`, `edit-plan`,
  `edit-self`, `iteration-plan`, `bug-hunt-finding`, `background-task`, `swarm-task`) and their cards.

Per [ADR 012](012-lean-nexus-integration-cockpit.md) we replace the engine with an embedded OSS chat
([claudecodeui](https://github.com/siteboon/claudecodeui) driving host Claude Code — now substrate-registered
per [mcp-substrate runbook](../runbooks/mcp-substrate.md)) so we stop maintaining a bespoke engine and ride
Claude Code's continuous updates. But the governance views are Nexus's unique value and **must be preserved.**

**Key finding (full inventory in `task_plan-chat-replacement.md`): the seam already exists.** Typed blocks are
parsed + persisted **server-side** by `lib/chat/persist-completed-turn.ts` into DB tables (`operator_tasks`,
`background_tasks`, `bug_hunt_findings`, `chat_messages.metadata`, `chat_permission_requests`). The standalone
views (`components/chat-views/{Tasks,Approvals,BackgroundTasks,BugHunt}View.tsx`, `/inbox`, `/approvals`) read
those **tables**, not the chat component. They survive the engine swap with zero changes.

## Decision

**KEEP (the governance rail — unchanged):** all 8 typed-block parsers (`lib/chat/*`), `persist-completed-turn.ts`,
the standalone Views, `/inbox` + `/approvals`, and the DB tables. The operator's unique views (manual tasks,
approvals, background/swarm tasks, bug-hunt findings) move from *inline-in-conversation* cards to the dedicated
**governance rail** that already exists.

**REPLACE (the engine):** `PlatformChat.tsx` + the poll/SSE/session UI → embedded claudecodeui (host Claude Code).

**Re-home typed-block parsing via a Claude Code Stop hook** (not `/api/platform-chat`): when a turn completes in
the OSS engine, a hook POSTs the assistant message to a new `POST /api/chat/ingest-turn`, which runs the SAME
`parseTurnBlocks()` + `persistCompletedTurn()`. So the agent keeps emitting typed blocks, they keep getting
parsed + persisted, and the governance rail keeps updating — independent of which engine produced the message.
(Per-agent hooks are already a supported mechanism — see AGENTS.md "Per-agent hooks".)

**Re-home agent context:** the `platform-copilot` / `business-copilot` system prompts + business-scoping become a
Claude Code project `CLAUDE.md` + agent config the OSS engine loads (the substrate MCP servers are already
registered host-wide).

**Incremental + non-breaking:** embed the OSS chat as a NEW surface ALONGSIDE the working bespoke chat first;
migrate primary usage; retire `PlatformChat.tsx` LAST. Never break the operator's live control surface mid-flight.

## Consequences

- **Easier:** delete a ~2000-line engine; the chat tracks Claude Code's roadmap; governance UX preserved (and
  arguably cleaner as dedicated surfaces); the OSS engine inherits the MCP substrate for free.
- **Harder / watch:** the one thing genuinely lost is *inline-in-conversation* approval cards — replaced by the
  governance rail (a different, decoupled UX). The Stop-hook ingest must be reliable (it's the new parsing trigger).
  Business-scoping + the copilot system prompts must be faithfully re-homed into Claude Code config.
- **Reversible:** coexistence means the bespoke chat stays until the OSS path is proven; retire only after.
