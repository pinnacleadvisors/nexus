# Task Plan — Chat engine replacement (keep the views, swap the engine)

> Initialised 2026-06-04. Decision: [ADR 013](docs/adr/013-chat-engine-replacement.md) · pivot: [ADR 012](docs/adr/012-lean-nexus-integration-cockpit.md).

## Step 0 — North Star

```
Goal:    Replace the bespoke chat ENGINE (PlatformChat.tsx ~2000 lines) with an embedded OSS chat
         (claudecodeui driving host Claude Code, substrate-registered), WITHOUT losing any of the
         unique Nexus governance views (manual-tasks, approvals, edit-plans, bug-hunt, background/swarm).

Success criteria:
  - Operator can run their primary agent work in the embedded OSS chat (with memory + connectors).
  - Every typed-block view still works (Tasks, Approvals, Background, BugHunt, /inbox, /approvals).
  - Typed blocks emitted in the OSS engine are parsed + persisted (via a Stop-hook → ingest route).
  - Bespoke chat retired only AFTER the OSS path is proven. Zero downtime of the control surface.

Hard constraints:
  - Don't break the live bespoke chat until the OSS path is proven (coexistence first).
  - Keep all governance tables + views + parsers untouched.
  - Business-scoping + copilot system prompts faithfully re-homed (not dropped).
```

## The seam — KEEP vs REPLACE (from the 2026-06-04 inventory)

### ✅ KEEP (governance rail — unchanged; already DB-backed + standalone)
- Parsers: `lib/chat/{approval,manual-task,edit-plan,edit-self,iteration-plan,bug-hunt-finding,background-task,swarm-task}.ts`
- Persistence: `lib/chat/persist-completed-turn.ts` (`parseTurnBlocks()` + `persistCompletedTurn()`)
- Views: `components/chat-views/{Tasks,Approvals,BackgroundTasks,BugHunt,Calendar}View.tsx`
- Pages: `/inbox` (4-source aggregate), `/approvals` (5-gate matrix + fleet)
- Tables: `operator_tasks`, `background_tasks`, `bug_hunt_findings`, `chat_messages(.metadata)`, `chat_permission_requests`
- Approval action: `APPROVAL [<id>]: approve …` reply + `/api/approvals/[id]/decide`

### ⛔ REPLACE (engine)
- `components/platform-chat/PlatformChat.tsx` (+ inline cards: streaming/poll loops, session sidebar, message bubbles)
- `/manage-platform` + `/businesses/[slug]/chat` shells → embedded OSS chat
- Dispatch UI coupling to `/api/platform-chat` poll/stream (the OSS engine talks to Claude Code directly)

### 🔗 NEW glue (small)
- `POST /api/chat/ingest-turn` — accepts an assistant turn, runs the existing `parseTurnBlocks()` +
  `persistCompletedTurn()`. The parsing/persistence is **reused verbatim**; only the trigger changes.
- A Claude Code **Stop hook** that POSTs each completed turn to that route. (Per-agent hooks already supported.)
- A Nexus copilot **`CLAUDE.md` + agent config** the OSS engine loads (re-homes platform/business copilot context).

## Phases (incremental, non-breaking)

### Phase 1 — Coexistence: embed the OSS chat as a NEW surface
- Stand up **claudecodeui** on the Mac (like Paperclip: install + launchd). It drives host `claude`
  (substrate MCP already registered).
- Embed it in Nexus at `/code` (or a "Claude Code" tab) via the **same Clerk-authed iframe proxy pattern**
  as `/workforce` (`/api/code/ui/[...path]` → claudecodeui; loopback-only, Nexus is the authed entry point).
- Operator can start using it immediately. Bespoke chat untouched. **First increment.**

### Phase 2 — Re-home typed-block parsing
- Build `POST /api/chat/ingest-turn` (wraps existing `parseTurnBlocks` + `persistCompletedTurn`).
- Add the Claude Code Stop hook (host-level or per-project) that POSTs completed turns to it.
- Verify: emit a `manual-task` block in the OSS chat → it appears in `TasksView` / `/inbox`.

### Phase 3 — Re-home agent context
- Author the copilot `CLAUDE.md` + agent config (system prompt, business-scoping, approval-gate behavior)
  the OSS engine loads. Verify the OSS chat behaves like platform-copilot (emits the right blocks, respects gates).

### Phase 4 — Migrate + retire
- Point `/manage-platform` to the OSS surface; keep bespoke reachable behind a flag during soak.
- After soak: delete `PlatformChat.tsx` + the now-unused `/api/platform-chat` poll/stream routes. Banner-demote
  the chat plans (already done). Governance rail stays.

## Progress (2026-06-04)
### Completed
- [x] ADR 013 + this plan; full keep/replace inventory; seam identified (governance is DB-backed + standalone).
### Remaining
- [ ] Phase 1 — stand up claudecodeui + embed at `/code` (next increment).
- [ ] Phases 2–4.
### Open questions
- claudecodeui vs opencode-web as the engine (claudecodeui drives Claude Code + opencode/Codex; leaning claudecodeui).
- Whether business-scoping needs per-business Claude Code workspaces or one workspace + context switching.
