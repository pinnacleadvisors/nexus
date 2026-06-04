> ⛔ **SUPERSEDED 2026-06-04 — [ADR 012](docs/adr/012-lean-nexus-integration-cockpit.md) lean-Nexus pivot (chat = embed + replace).** Multi-agent → Paperclip; chat surface → embedded UI.
> Bespoke chat engine demoted for an embedded Claude Code/opencode web UI; governance affordances re-homed. See [task_plan-lean-nexus-pivot.md](task_plan-lean-nexus-pivot.md). Kept for history.

# task_plan — Collaborative chat (super-harness + mode/model/swarm/background views + mobile)

> Long-horizon plan per [AGENTS.md §Long-Horizon Task Protocol](AGENTS.md#long-horizon-task-protocol). The operator's framing:
>
> _"I like the process you just did. The chats in nexus lack that collaborative feel, like I'm talking to a real human worker and collaborating in real time."_
>
> The qa-runner bootstrap we just shipped had the feel: narrate-investigate-propose-approve-execute-narrate, with approval cards and PRs as the gates. That experience exists today *only because the platform-copilot agent spec encodes it*. We want it to be the default across every Nexus chat — including business-copilot and any future per-business chat — and to feel as polished on a phone as it does on a laptop.
>
> Companion to [`task_plan-mobile-copilot.md`](task_plan-mobile-copilot.md) (which shipped the mobile foundations) and the still-in-flight [`task_plan-debug-loop-oss-frameworks.md`](task_plan-debug-loop-oss-frameworks.md) (which adds testing primitives the chat will use).

## North Star

**Goal:** Make every Nexus chat feel like collaborating with a real human worker — present, narrating their work, asking the right questions at the right times, capable of long-running tasks, swarms, and background jobs — and let the operator drive that experience from a phone as comfortably as a laptop.

**Success criteria:**

- **Super harness** — every chat (platform, business, future per-niche) inherits a shared set of primitives: typed blocks (`approval-request`, `edit-plan`, `manual-task`, `signals`, **new**: `background-task`, `swarm-task`, `manual-task-update`, `manual-task-complete`), permission modes, model selection, view delegation, memory writes on completion. New chat surfaces fork the harness, not the platform-copilot spec.
- **Background tasks view** — operator sees agent-spawned long-running work in real time (status, ETA, output stream). Agent can emit a typed `background-task` block that creates an Inngest job + a Board row; the view polls + renders. Agent can cancel, restart, or check on a job mid-conversation.
- **Swarm view** — same primitive as background-tasks but N-parallel. Agent emits a typed `swarm-task` block with sub-tasks. View renders one column per sub-agent (researcher / builder / writer / etc., mirroring `pdf-swarm-lead`'s roster). Cost-guard + kill-switch gate the spawn.
- **Mode dropdown** — composer footer chip alongside the existing timeout + provider chips. Three modes: `ask` (default — every destructive action emits an `approval-request`), `plan` (agent proposes plans, never executes), `auto` (agent executes within structurally-isolated bounds without per-action approval, but still gates on the five operator-only categories — deploys, money movement, customer-facing sends, env writes, secret rotation).
- **Manual-tasks collaboration** — agent can update or close items it previously emitted. New typed blocks: `manual-task-update` (patch fields), `manual-task-complete` (mark done, optionally remove). Manual tasks view surfaces "agent edited this" badges.
- **Model dropdown** — composer footer chip. Per-turn override of the model used (Opus / Sonnet / Haiku / Codex direct). Defaults to operator's saved preference per chat surface. The gateway is already model-aware via the dispatch body; this exposes it.
- **Mobile-optimised chat** — at viewport ≤ 640 px, the chat UI matches Claude Code's mobile-app feel: bottom-sheet (not side-panel) for views, full-screen modals (not inline cards) for approvals, hamburger-revealed session sidebar (not always-visible), composer footer chips wrap into a single tappable row, scroll behaviour respects the keyboard, no horizontal overflow anywhere.

**Hard constraints:**

- **Cannot regress the existing platform-copilot UX** at the desktop viewport. Every change must be additive or behind a feature flag for the first deploy.
- **Cannot break the existing typed-block contract.** Agent specs already in production (`platform-copilot`, `business-copilot`, `bug-hunt-loop`, `pdf-swarm-lead`, `create-business`) keep working without spec changes; new blocks land alongside existing ones.
- **Cannot bypass the operator-owned approval categories** from [AGENTS.md](AGENTS.md) — even in `auto` mode, deploys / money movement / customer-facing actions / env writes / secret rotation still gate through an `approval-request`. The dropdown narrows the *non-destructive* surface; the structurally-irreversible ones stay locked.
- **Cannot make mobile worse for desktop or vice versa.** Every UI change is verified at both 1280 px and 375 px viewports — pre-commit checklist already enforces this (PR #279).
- **Cannot exceed the existing kill-switch envelope.** New features (especially swarm + background tasks) route through `checkKillSwitch(businessSlug)` before any LLM call. Cost of "always-on" enhancements (mode/model dropdowns) is zero marginal.

## Background — what's already in place

Findings sourced 2026-05-24 via direct reads + earlier work this session:

- **Typed blocks shipped**: `approval-request` (PR #196 era), `edit-plan` + `edit-group-complete` (mobile-copilot Phase 1 contemporary), `manual-task` (read-only, no agent-update path yet), `signals` (Paperclip absorption Phase 2 Task B), `permission-broker` cards (PR #189).
- **Views shipped**: Manual To-dos, Approvals queue, Calendar, Bug Hunt, Platform health — all in `components/chat-views/` rendered inside `ViewsPanel`. The pattern is "operator picks a view from `ViewsDropdown`; the panel takes the right third of the screen on desktop, full-overlay on mobile".
- **Existing composer chips**: `TurnTimeoutSelector` (PR #278 — mobile-copilot Phase 1), `ChatProviderToggle` (Codex vs Claude routing), `ContextIndicator`. Footer is `flex flex-wrap items-center gap-2` post-Phase 2 → trivially extensible.
- **Permission modes today**: hard-coded across agent specs. platform-copilot says "always interactive, never autonomous"; business-operator says "autonomous with approval gates"; pdf-swarm-lead spawns when `swarm: true`. No per-turn dropdown.
- **Model routing today**: `/api/platform-chat/route.ts` accepts `provider: 'claude' | 'codex'`. The model used by claude-gateway is whatever the `claude` CLI binds — currently Opus 4.7. No per-turn model override exposed in the body.
- **Mobile foundations**: Phase 2 of mobile-copilot shipped (KpiGrid mobile-first, Sidebar auto-collapse <640, 44px tap targets, Playwright iPhone/Android projects). The chat composer's footer wraps on narrow viewports. But ViewsPanel still renders as a side-panel on mobile, FloatingActionBar overlays awkwardly, and approval cards are full-width inline (not full-screen overlays).
- **Background work primitive**: Inngest is the platform's queue (`app/api/inngest/`). The Board has a `tasks` table that already represents background work. n8n is also available for workflow-shaped jobs. `lib/claw/gateway-jobs.ts` is the async-job dispatch path.
- **Swarm primitive**: `pdf-swarm-lead` agent exists with a 6-member roster (researcher / brand-builder / builder / content-writer / marketer / support). Dispatched via `/api/claude-session/dispatch` with `swarm: true`. No UI surface for the operator to observe the swarm running.
- **Workflow-optimizer**: ships review-feedback → diff-on-agent-spec → log to `workflow_changelog`. This is the "evolves over time" primitive — already in production for one slice. Generalises to "hooks / skills / mode defaults / model choice".

## The super-harness framing — what it means concretely

Inspired by Claude Code's harness, the operator wants Nexus chats to inherit the same compounding-value property: every interaction makes future interactions better.

Five layers that get reused across every chat agent (platform, business, niche-specific, future):

1. **Typed-block contract** (already exists, extended this initiative) — the canonical agent → UI surface. Every block has a server-side extractor in `lib/chat/<block>.ts`, a client-side renderer in `components/platform-chat/<Block>Card.tsx`, and zero coupling to the specific agent that emitted it. New block = one file in each location, no agent-spec changes required.

2. **Permission modes + tool budgets** (this initiative) — like Claude Code's settings.json `permissions.defaultMode`. The agent inherits a mode (ask / plan / auto). Mode shapes which actions auto-fire vs gate on `approval-request`. Operator can flip per-turn via the new dropdown.

3. **Hooks** (already partially shipped — `services/claude-gateway/entrypoint.sh` writes a `hooks` block per PR #281) — generalise to per-agent hook config in `agent_library`. Operator-level hooks live in `~/.claude/settings.json`; business-level hooks live in the per-business container's settings.

4. **Skills + memory** (already exists — `/molecularmemory_local`, `/signals-briefing`, MCP `memory-hq`) — generalise so every chat agent can invoke them. Today only platform-copilot has the full set; business-copilot is symmetric but the skills aren't wired everywhere. New chat agents fork the platform-copilot manifest.

5. **Workflow-optimizer feedback loop** (already exists for review-node feedback) — extend to: "the operator flipped to `plan` mode three turns in a row → suggest making `plan` the default for this chat surface", "the operator picked Opus + 60m timeout for a class of asks → record as the preferred default". Closes the "evolves over time" loop.

The dropdown initiative (mode + model) is the *operator's lever* on layer 2. The view initiatives (background, swarm, manual-tasks collaboration) are layer 1 extensions. Mobile is presentation polish across all layers.

## Phases & atomic tasks (operator approves each before kickoff)

Six phases, ordered by leverage. Phases 1–3 ship independently in 1-2 days each; phases 4–5 are bigger and depend on each other; phase 6 is incremental learning across the rest.

---

### Phase 1 — Mode + Model dropdowns (smallest, highest UX value, ships first)

#### Task 1A — Server: extend dispatch body with `mode` + `modelOverride`

- File: `app/api/platform-chat/route.ts` + `app/api/businesses/[slug]/chat/route.ts` — extend `PlatformChatBody` / `Body` with `mode?: 'ask' | 'plan' | 'auto'` and `modelOverride?: string` (e.g. `'claude-opus-4-7'`, `'claude-sonnet-4-6'`, `'codex-direct'`).
- File: `lib/claw/gateway-jobs.ts` — thread both through `EnqueueJobOpts`.
- File: `services/claude-gateway/src/index.ts` — extend `messageBodySchema` to accept both; clamp `modelOverride` to a whitelist; pass `mode` to the agent via an env var (`NEXUS_CHAT_MODE`) the agent reads on its first turn.
- Parallel: no — foundation for 1B/1C.

#### Task 1B — Composer UI: two new chips next to TurnTimeoutSelector

- File: `components/platform-chat/ModeSelector.tsx` (new) — chip with three options (ask / plan / auto). Default = `ask`. Tooltip explains each + cites the five operator-only categories that stay gated regardless.
- File: `components/platform-chat/ModelSelector.tsx` (new) — chip with the model whitelist. Default = whatever the chat surface's saved preference is (localStorage key `nexus:<surface>:model`).
- File: `components/platform-chat/PlatformChat.tsx` + `components/business-chat/BusinessChat.tsx` — wire both selectors into the composer footer + send body.
- Parallel: yes (mostly UI; depends on 1A's API contract).

#### Task 1C — Agent spec consumption

- Update `.claude/agents/platform-copilot.md` § "Required approval gates" to document the three modes + what each mode changes vs the static five-category list.
- Update `.claude/agents/business-copilot.md` likewise.
- Convention: the agent reads `process.env.NEXUS_CHAT_MODE` at turn start; in `auto` mode it skips `approval-request` for non-destructive read-only actions and small file edits, but still emits gates for the five categories. In `plan` mode the agent emits a plan and `END.OF.TURN`-style sentinel, never executes.
- Parallel: yes (docs).

---

### Phase 2 — Mobile-optimised chat layout (Claude Code mobile-app patterns)

#### Task 2A — Bottom-sheet view pattern (replaces side panel < md)

- File: `components/chat-views/ViewsPanel.tsx` — at viewport ≤ 768px, render as a bottom-sheet (drag-handle, snap-points, dismiss on swipe-down) instead of a right-side panel. Reuse a small library (Vaul or radix) — confirm before adding.
- Tasks/Approvals/Calendar/BugHunt/Health views all become bottom-sheets on mobile without per-view changes.
- Parallel: yes (single component edit).

#### Task 2B — Approval cards as full-screen modals on mobile

- File: `components/platform-chat/ApprovalCard.tsx` — at ≤ 640px, when the card has >2 items, render as a full-screen modal with one tap-friendly button per item. Inline rendering on desktop unchanged.
- File: `components/platform-chat/PermissionPromptCard.tsx` — same treatment.
- File: `components/platform-chat/EditPlanCard.tsx` — same.
- Parallel: yes (three independent edits).

#### Task 2C — Session sidebar hamburger reveal on mobile

- File: `components/platform-chat/SessionSidebar.tsx` — at ≤ 640px, hide by default + add a hamburger button in the top-left of the chat header. Tap reveals the sidebar as a slide-over (full-height, 80% width, dim backdrop).
- Parallel: yes.

#### Task 2D — Composer footer single-row layout < md

- File: `PlatformChat.tsx` + `BusinessChat.tsx` composer footer — at ≤ 640px, the four chips (timeout, mode, model, provider) collapse into one row with smaller icon-only chips + a "..." overflow for any extras (Context indicator, manual ChatProviderToggle).
- Parallel: yes.

#### Task 2E — Keyboard-aware scroll behaviour

- File: `PlatformChat.tsx` — when the textarea is focused on iOS Safari, scroll the conversation up so the last message stays visible above the keyboard. Use `visualViewport` API.
- Tap-and-hold on a message → reveal copy / edit / delete actions (Claude Code style).
- Parallel: yes.

#### Task 2F — Playwright mobile chat specs

- File: `tests/playwright/chat-mobile.spec.ts` (new) — asserts: composer chips don't horizontally overflow at 375px; views render as bottom-sheets; approval cards open as full-screen modals; session sidebar reveals via hamburger.
- Add a `chat-mobile.spec.ts` mirror to `services/qa-runner/e2e/` for live-deploy smoke parity.
- Parallel: yes — depends on 2A-E shipping first.

---

### Phase 3 — Manual-tasks collaboration (agent emits update / complete)

#### Task 3A — New typed blocks

- File: `lib/chat/manual-task.ts` (extend existing) — define `manual-task-update` (patch fields by `id`) and `manual-task-complete` (mark done; optional `remove: true` to delete vs just check-off).
- File: `app/api/platform-chat/poll/route.ts` + `app/api/businesses/[slug]/chat/poll/route.ts` — extract the new blocks from agent assistant text; persist updates to the `tasks` table.
- File: `components/chat-views/TasksView.tsx` — render an "agent updated" badge on rows touched in the last 5 minutes; render strikethrough on rows the agent completed.
- Parallel: yes.

#### Task 3B — Agent spec documentation

- Extend `.claude/agents/platform-copilot.md` § "Flagging manual work" with the new update/complete blocks + worked examples (agent finishes work → emits `manual-task-complete` with the original `id` → row strikes through).
- Same for `.claude/agents/business-copilot.md`.
- Parallel: yes.

---

### Phase 4 — Background tasks view + agent delegation

#### Task 4A — Schema + dispatch infrastructure

- File: `supabase/migrations/0NN_background_tasks.sql` (new) — table `background_tasks(id, chat_session_id, business_slug, status, kind, payload, result, started_at, finished_at, cancelled_at)`.
- File: `lib/background-tasks/dispatch.ts` (new) — `enqueueBackgroundTask({ kind, payload, sessionId })` that creates the row + fires an Inngest event.
- File: `app/api/inngest/route.ts` — register handlers per `kind` (initial set: `playwright-run`, `firecrawl-crawl`, `claude-session-dispatch`, `n8n-workflow-trigger`).
- Parallel: no — foundation.

#### Task 4B — Agent block: `background-task`

- File: `lib/chat/background-task.ts` (new) — type definitions + extractor.
- Convention: agent emits ```` ```background-task { "task_id": "<slug>", "kind": "...", "summary": "...", "estimated_duration_s": <n>, "payload": {...} } ``` ````.
- The chat poll route extracts, creates the row via `enqueueBackgroundTask`, returns the `task_id` back to the chat for rendering.
- Parallel: yes (after 4A).

#### Task 4C — Background tasks view + card

- File: `components/chat-views/BackgroundTasksView.tsx` (new) — polls `/api/background-tasks?session=<id>` every 5s, renders each row with status badge + progress.
- File: `components/platform-chat/BackgroundTaskCard.tsx` (new) — inline card the assistant message renders, links to the BackgroundTasksView row.
- File: `components/chat-views/ViewsDropdown.tsx` — add "Background tasks" entry with the running count badge.
- Parallel: yes.

#### Task 4D — Cancel + restart actions

- File: `app/api/background-tasks/[id]/cancel/route.ts` (new) — sets `cancelled_at` + fires Inngest cancel signal. Owner-gated.
- File: `app/api/background-tasks/[id]/restart/route.ts` (new) — clones the row with fresh `status='pending'`.
- View renders the buttons; agent can also emit a `background-task-cancel` block to cancel its own jobs (rare but useful).
- Parallel: yes.

---

### Phase 5 — Swarm view + agent delegation

#### Task 5A — Swarm block + UI

- File: `lib/chat/swarm-task.ts` (new) — extends `background-task`'s shape with `subtasks: BackgroundTask[]`. The parent row has `kind: 'swarm'`; each subtask is a child row with `parent_id`.
- File: `components/chat-views/SwarmView.tsx` (new) — column-per-subtask kanban layout, each column showing the sub-agent's status + last 3 lines of streaming output.
- File: `components/platform-chat/SwarmCard.tsx` (new) — inline card with one-line-per-subtask summary.
- Parallel: yes — depends on Phase 4 schema.

#### Task 5B — Swarm dispatch with cost-guard

- File: `lib/background-tasks/swarm-dispatch.ts` (new) — wraps `enqueueBackgroundTask` to:
  1. Pre-flight `checkKillSwitch(businessSlug)` for the parent.
  2. Estimate cost: subtasks × per-subtask budget. Abort if over `USER_DAILY_USD_LIMIT`.
  3. Fan-out subtasks to Inngest (or direct Claude/Codex dispatch); parent row aggregates results.
- Mirror the existing `pdf-swarm-lead` AGENTS.md rule: ≥3 plausibly-independent subtasks, ≥2 tools per subtask.
- Parallel: yes (after 5A).

#### Task 5C — Agent spec extensions

- `.claude/agents/platform-copilot.md` — add a "Delegating to a swarm" section. When to emit `swarm-task` instead of `edit-plan` or `background-task`. Worked example: "build the v1 storefront across landing+checkout+email+social" → 4 parallel subtasks.
- Same for `.claude/agents/business-copilot.md` (more relevant for per-business work).
- Parallel: yes.

---

### Phase 6 — Super-harness evolves-over-time hooks (longer running, incremental)

#### Task 6A — Per-agent hooks in `agent_library`

- File: `supabase/migrations/0NN_agent_hooks.sql` (new) — `agent_library.hooks jsonb` column. Same shape as Claude Code's settings.json hooks block (PreToolUse / UserPromptSubmit / SessionStart / etc.).
- File: `services/claude-gateway/entrypoint.sh` — extend the existing hooks block (from PR #281) so per-agent hooks merge on top of the repo-wide `.claude/hooks/`.
- Parallel: yes — does not block other phases.

#### Task 6B — Mode / model defaults learned from operator behaviour

- File: `lib/learning/chat-preferences.ts` (new) — reads recent `chat_sessions` for a surface, computes the most-picked mode + model + timeout, surfaces as the new default after 10 picks.
- workflow-optimizer extension: detect "operator flipped to plan mode N turns running" → propose updating the chat surface's default. Operator clicks to accept.
- Parallel: yes.

#### Task 6C — Skills + memory wiring symmetry

- Audit which skills / MCP servers are wired in claude-gateway vs codex-gateway vs per-business gateways. Today only claude-gateway has the full set; the others lag.
- File: `services/<gateway>/entrypoint.sh` — port the missing skill + MCP registrations.
- Parallel: yes.

#### Task 6D — Memory write on chat-session-close

- File: `app/api/platform-chat/sessions/[id]/route.ts` — on DELETE, fire a `memory_atom` per closed session if the agent didn't already write one. Captures the durable lesson before the session is gone.
- Parallel: yes.

---

## Verification per phase

After each phase ships (one PR per phase, six PRs total):

- `npx tsc --noEmit` clean.
- `npm run check:retry-storm` + `check:lockfile` + `check:sentry-config` clean.
- Playwright `chromium` + `iphone` + `android` projects green.
- Manual operator pass at both 1280px + 375px viewports.
- ADR for each phase that introduces new typed blocks or DB schema.
- memory-hq atom for each non-trivial pattern learned (e.g. "Coolify v4 quirks for compose with networks").

## Timeline (rough)

| Phase | Effort | Depends on |
|---|---|---|
| 1 — Mode + Model dropdowns | 1.5 days | — |
| 2 — Mobile-optimised chat | 3-4 days | — (independent of Phase 1) |
| 3 — Manual-tasks collaboration | 1 day | — |
| 4 — Background tasks view | 3-5 days | Phase 1 (mode `auto` makes background-task useful) |
| 5 — Swarm view | 2-3 days | Phase 4 schema |
| 6 — Super-harness evolves | open-ended | Phase 1 + Phase 5 |
| **Total** | ~10-15 days | shippable in chunks |

Phases 1, 2, 3 can ship in parallel (no shared files at risk of merge conflict). Phase 4 depends on Phase 1 conceptually; Phase 5 needs Phase 4's table.

## Risks

- **Scope creep into Claude Code Desktop parity.** The reference (Claude Code's mobile app) sets a high bar. Mitigation: focus on the operator's actual mobile use case (managing while travelling) — not feature-for-feature parity.
- **Mode = `auto` accidentally widens the destructive surface.** Mitigation: the five operator-only categories from AGENTS.md (deploys / money / customer-facing / env / secret rotation) stay gated regardless of mode. The mode only affects the *non-destructive* surface (read-only investigations, draft PR creation, small file edits in a worktree).
- **Background tasks queue overload.** A chat that emits 10 background tasks/turn could overrun Inngest's free tier. Mitigation: per-session rate-limit (5/session/hour), per-business cost-guard envelope, kill-switch.
- **Swarm cost runaway.** Same shape as background-tasks but × N. Mitigation: Task 5B's pre-flight cost estimate aborts before any fan-out.
- **Mobile-app polish vs operator's other priorities.** Phase 2 alone is 3-4 days. If the operator wants the mode/model dropdowns + background tasks more urgently, defer Phase 2 polish to a follow-up and ship the mobile *minimum* (bottom-sheet views, full-screen approval cards) in Phase 2-lite first.

## Open questions (operator confirm before kickoff)

1. **Phase order**: ship in the order above (1 → 2 → 3 → 4 → 5 → 6), or prioritise Phase 4 (background tasks) earlier since it unblocks more agent work?
2. **Mode `auto` default per chat surface**: should `business-operator` autonomous flows count as "always `auto`" and skip the dropdown entirely? Default in this plan = the dropdown is operator-set per turn, agents inherit the operator's pick.
3. **Bottom-sheet library**: Vaul (lightweight, Radix-aligned) or hand-rolled with framer-motion? Default = Vaul (tested at scale across Vercel ecosystem).
4. **Model whitelist**: ship with `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `codex-direct` (4 options), or include the older 4.5 / 4.6 Opus too for fallback? Default = 4-option whitelist; older versions added on demand.
5. **Background tasks lifetime**: keep rows for N days then archive? Default = 30 days then auto-archive, 90 days then delete. Operator override per business.
6. **Swarm minimum subtasks**: AGENTS.md says ≥3 plausibly-independent. Should the dispatch reject swarms with <3? Default = yes, fall back to `background-task` if 1 or 2.
7. **In-flight work** — task #11 (qa-runner Coolify deploy) sits at PR #284 awaiting your merge click. Do we resume that immediately after you approve this plan, or pause it longer while we knock out Phase 1?

## Progress (as of 2026-05-24)

### Completed

- [x] North Star + phased plan written (this doc)
- [x] Mobile-copilot Phase 1 (timeout selector) — already shipped (PR #278)
- [x] Mobile-copilot Phase 2 (mobile foundations) — already shipped (PR #279)
- [x] Mobile-copilot Phase 3 (platform-copilot autonomy + hooks) — already shipped (PR #280)
- [x] qa-runner Doppler convention + Coolify create script (#281, #282, #283, awaiting #284 merge)

### Awaiting operator approval

- [ ] Phase 1 — Mode + Model dropdowns (1.5 days)
- [ ] Phase 2 — Mobile-optimised chat (3-4 days)
- [ ] Phase 3 — Manual-tasks collaboration (1 day)
- [ ] Phase 4 — Background tasks view (3-5 days)
- [ ] Phase 5 — Swarm view (2-3 days)
- [ ] Phase 6 — Super-harness evolves (incremental)
