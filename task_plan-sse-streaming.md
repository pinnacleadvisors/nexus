> ⛔ **SUPERSEDED 2026-06-04 — [ADR 012](docs/adr/012-lean-nexus-integration-cockpit.md) lean-Nexus pivot (chat = embed + replace).** The embedded chat UI handles its own streaming.
> Bespoke chat engine demoted for an embedded Claude Code/opencode web UI; governance affordances re-homed. See [task_plan-lean-nexus-pivot.md](task_plan-lean-nexus-pivot.md). Kept for history.

# task_plan-sse-streaming.md

Durable Layer-2 plan for the chat SSE-streaming initiative. The Layer-3 scratch (with the full architectural rationale + alternatives) lives at `~/.claude/plans/fancy-singing-snail.md` on this machine.

## Goal
Replace the 2.5s poll loop in PlatformChat with token-by-token SSE so the operator sees agent replies stream live — matching Claude Code Desktop's UX — without breaking any of the persistence, approval-card, edit-plan, or cross-business approval-inbox machinery layered on top.

## Success criteria
- New assistant turn in `/manage-platform/chat` streams ≤ 2s perceived to first visible token.
- `approval-request`, `manual-task`, `iteration-plan`, `edit-plan`, `bug-hunt-finding` fenced blocks still render as inline cards via FloatingActionBar after the message completes.
- `ToolCallCard` entries still appear (Phase 2 = progressive).
- Reload a chat session URL → existing messages still load via the initial fetch; only NEW assistant turns stream.
- Disconnect mid-stream → graceful retry; no half-message state stuck.
- Status banner in PlatformChat stops lying — drop the "SSE streaming is still deferred" line.
- BusinessChat unaffected (stays on poll for Phase 1).

## Hard constraints
- `chat_sessions` + `chat_messages` write shape unchanged — load-bearing for `/api/approvals/fleet` (PR #203) and the `metadata.crashed` / `metadata.edit_plans` resume hints in `app/api/platform-chat/route.ts`.
- AGENTS.md retry-storm rule: every new fetch gets `AbortSignal.timeout(...)`; every SSE connection has explicit close.
- AI SDK 6 patterns where they fit, custom protocol where they don't — the gateway payload (`approval_requests`, `edit_plans`, `tool_calls`, `crashed`, etc.) is too rich for `useChat`'s text+tool-delta schema; a hand-rolled SSE reader mirroring `lib/claw/gateway-call.ts` L103-149 is shorter and cleaner.
- Cost discipline — no smoke prompts > 5 turns total during dev. Operator runs the actual smoke on Vercel preview after PR opens.
- Read-only first; no production mutations from inside the testing loop.

## Architecture summary

Three-route shape (additive — nothing existing is removed):

| Route | Method | Purpose | maxDuration |
|---|---|---|---|
| `/api/platform-chat` | POST | UNCHANGED — enqueue gateway job, persist user message, return `{ jobId, sessionId }` | 30 |
| `/api/platform-chat/stream` | GET | NEW — SSE bridge, inner-polls gateway every 250ms, emits delta/done/continue/error/heartbeat | 300 |
| `/api/platform-chat/poll` | GET | UNCHANGED (refactored internally to share persist logic) — fallback when SSE drops or is disabled | 15 |

Wire format (see `lib/chat/stream-events.ts`):
- `event: ready`   `data: { jobId, sessionId, sessionTag, usage }`
- `event: delta`   `data: { text }`
- `event: heartbeat`  `data: {}`  (plus a `: heartbeat\n\n` SSE comment immediately on open + every 15s to defeat proxy buffering)
- `event: done`    `data: { text, approval_requests, tool_calls, manual_tasks, iteration_plans, edit_plans, edit_group_completes, pending_permission_requests, crashed, durationMs }`
- `event: continue` `data: { jobId, sessionId, reason: 'max_duration_approaching' }`
- `event: error`   `data: { code: 'enqueue_failed'|'queue_full'|'stream_disabled'|'mid_stream'|'gateway_error', message, jobId? }`

Client behavior:
- Server env `PLATFORM_CHAT_STREAM_ENABLED` (default `'1'`) gates the route.
- Client env `NEXT_PUBLIC_PLATFORM_CHAT_STREAM_ENABLED` (default `'0'` initially) gates the *attempt* so a rollback skips the round-trip.
- Client always falls back to the existing `pollUntilDone(jobId, sessionId)` on any `continue`, `error` (with jobId), or thrown stream-reader error.

## Atomic task list

| # | Task | Status |
|---|---|---|
| 1 | Write this `task_plan-sse-streaming.md` (durable Layer-2 plan) | ✅ |
| 2 | New `lib/chat/stream-events.ts` — typed wire format + SSE writer helpers | ⬜ |
| 3 | New `lib/chat/persist-completed-turn.ts` — extract done-branch logic from poll route | ⬜ |
| 4 | Refactor `app/api/platform-chat/poll/route.ts` to call `persistCompletedTurn` | ⬜ |
| 5 | New `app/api/platform-chat/stream/route.ts` — SSE GET handler | ⬜ |
| 6 | Modify `components/platform-chat/PlatformChat.tsx` — add `streamUntilDone`, wire into `send()`, update banner | ⬜ |
| 7 | Modify `memory/platform/SECRETS.md` — document `PLATFORM_CHAT_STREAM_ENABLED` + public mirror | ⬜ |
| 8 | Pre-commit checks: `tsc --noEmit`, `check:retry-storm`, `check:sentry-config` | ⬜ |
| 9 | Open PR off `main` with Phase 2/3 deferral spelled out in body | ⬜ |

## Pitfalls (Plan-agent review)

1. **Function lifetime leak** — `ReadableStream` keeps the Vercel function billed until close. Unconditional `break` on `status === 'done' | 'error'`; `try/finally controller.close()`; `AbortSignal` on every inner `getGatewayJob`.
2. **Persistence double-write** — on `continue` (Vercel timeout), the SSE handler MUST NOT call `persistCompletedTurn`. Hand off to client → existing poll → poll writes when done. Otherwise two writes.
3. **Heartbeat is necessary AND insufficient** — send `: heartbeat\n\n` (SSE comment) immediately after writing headers AND every 15s. The immediate one flushes the response so Cloudflare/Vercel edge proxies don't buffer the first delta.
4. **Queue admission edge case** — if `enqueueGatewayJob` returns `queue_full` in the POST, there's no jobId. The stream client must distinguish error-with-jobId (poll fallback) from error-without (surface). The typed `code` field handles this.
5. **Client abort propagation** — `cancelRef.current=true` from the Cancel button must call `reader.cancel()` AND the AbortController's `.abort()`. The gateway job continues server-side after the client closes — same as today's poll cancel.

## Verification

### Static (must pass before commit)
- `npx tsc --noEmit` — zero errors
- `npm run check:retry-storm` — zero new findings (or every new fetch has `AbortSignal.timeout` + a `// retry-storm-check: ignore` justification)
- `npm run check:sentry-config` — no new bare `setInterval` in client; no `tracesSampleRate > 0.05`

### Manual smoke (operator-only, on Vercel preview)
1. Vercel preview deploys cleanly
2. Open `/manage-platform/chat`. Send `"List my Vercel deployments"`.
3. Tokens appear progressively (NOT all at end)
4. If reply contains `approval-request`: FloatingActionBar card renders after stream `done`
5. Click Approve → `APPROVAL [<id>]:` reply round-trips; next turn picks it up
6. Reload page → conversation history loads; next NEW turn uses SSE
7. `/dashboard` → FleetApprovalInbox (PR #203) still shows pending approvals correctly
8. Open BusinessChat → confirms it still works on poll (flag off / no SSE route used)
9. gateway-status spend chip increments expected amount
10. Mid-stream cancel → bubble closes, no leaked spinner; gateway job finishes server-side

### Rollback
- Flip `PLATFORM_CHAT_STREAM_ENABLED=0` in Doppler (server) AND `NEXT_PUBLIC_PLATFORM_CHAT_STREAM_ENABLED=0` (client). Both default to off if the flags are absent during the first deploy.

## Progress

(Empty — to be appended after each task lands.)

## Phase 2 / Phase 3 (separate PRs)

- Phase 2: BusinessChat adopts the same primitive; `ToolCallCard` updates progressively; remove client-side flag.
- Phase 3: searchable history + tool-transcript expandables (audit Section 6 #2 + #4).
