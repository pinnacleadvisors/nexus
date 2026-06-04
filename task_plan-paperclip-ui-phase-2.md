> ⛔ **SUPERSEDED 2026-06-04 — [ADR 012](docs/adr/012-lean-nexus-integration-cockpit.md) lean-Nexus pivot.** Use Paperclip's own UI; build only Nexus-unique surfaces in the cockpit.
> Demoted: see [task_plan-lean-nexus-pivot.md](task_plan-lean-nexus-pivot.md). Kept for history; do not resume without re-promotion.

# task_plan — Paperclip UI absorption, phase 2

> Long-horizon plan per [AGENTS.md §Long-Horizon Task Protocol](AGENTS.md#long-horizon-task-protocol). Companion to [`task_plan-paperclip-absorption.md`](task_plan-paperclip-absorption.md) which covered phase 1 (schema + adapters + initial UI scaffolds).

## North Star

**Goal:** Nexus's operator-facing surface matches Paperclip's utility-first minimalism — single Inbox for all "needs attention" signals, chat-driven business creation, command-palette navigation, agent-profile pages, heartbeat-scheduling visualisation — **without** losing the existing Nexus differentiators (per-business chat, USD/day kill switch, Composio breadth, memory-hq integration, the 5-category gate matrix).

**Success criteria:**
- Operator triages every cross-cutting signal from `/inbox` — no separate Approvals page in nav.
- Creating a new business is a chat with a consultant agent (`create_business`), not a forms page.
- `Ctrl+K` opens a command palette that navigates + dispatches agent actions.
- Each agent has a dedicated detail page surfacing role / system prompt / tools / runtime + recent runs.
- Heartbeat schedule is visible at a glance (which agents fired when, what's pending).
- `/signals` is no longer a route — its logic becomes a `signals_briefing` skill that platform-copilot can invoke via the existing chat.
- Visual style: rounded panels (this PR landed the sidebar), monospace for data, sparse accent colours, no fluff.

**Hard constraints:**
- Cannot remove `/signals`, `/idea`, `/approvals` routes until their replacements ship — operator may have bookmarks or scripts pointing at them. Drop from sidebar nav first, kill routes only after the migration data shows zero traffic.
- Cannot break the existing chat surface at `/manage-platform` or `/businesses/<slug>/chat` — those are the canonical platform-copilot + business-copilot entry points.
- `create_business` agent provisions real infrastructure (business_operators row + Coolify container + Cloudflare DNS); every mutating step gates through an `approval-request` block per the Ralph-loop pattern. NEVER auto-provisions silently.

## Already shipped (phase 1 — for context)

- [x] Schema absorption (migrations 046-052)
- [x] Adapter architecture (`lib/adapters/`)
- [x] `/businesses` rich overview (was `/companies`, merged in PR-267)
- [x] `/businesses/<slug>/issues`, `/<slug>/org-chart`, `/<slug>/chat`
- [x] `/approvals` page + `POST /api/approvals/[id]/decide`
- [x] Sidebar Inbox + rounded right edge (PR-273 this PR)
- [x] `/inbox` page — approvals + assigned issues + recent activity (PR-273)

## Phase 2 atomic tasks (operator-approve each before kickoff)

### Task A — `create_business` chat-consultant agent

- File: `.claude/agents/create-business.md` (new agent spec)
- File: `app/(protected)/businesses/new/page.tsx` (new chat-driven flow)
- Change: a conversational agent that asks the operator:
  1. Mission / niche / target customer
  2. Money model (subscription / one-off / ads / affiliate)
  3. Brand voice + initial KPI targets
  4. Required platform connections (Stripe, Shopify, ConvertKit, etc.)
- Then emits an `approval-request` summarising the proposed provisioning:
  - business_operators row insert (with mission, money_model, kpi_targets)
  - Coolify Docker container creation (per `lib/coolify/client.ts`)
  - Cloudflare DNS + tunnel ingress (per `scripts/migrate-tunnel-hostname.mjs`)
  - Composio connected_accounts seeding for each chosen platform
- On `APPROVAL [<id>]: approve` it fires the provisioning sequence and surfaces progress as typed blocks
- Replaces `/idea` page entirely. `/idea` route stays redirecting to `/businesses/new` until the next deploy cycle's audit confirms zero traffic.
- Parallel: no — foundation for Task B.

### Task B — `signals_briefing` skill for platform-copilot

- File: `.claude/skills/signals-briefing/SKILL.md` (new skill spec)
- File: `lib/skills/signals-briefing.ts` (the skill's implementation)
- Change: a skill platform-copilot invokes when the operator types "signals?" or "what's new?". Pulls the same data the old `/signals` page assembled (recent run_events, kill-switch checks, gate events, top spenders) and renders it as a typed `signals` block in the chat. Operator approves any follow-up actions via the existing `approval-request` block.
- Reuses the platform-copilot MCP set (Coolify, Cloudflare, GitHub via Composio, etc.) so the skill can drill into ANY signal the operator asks about.
- Drops `/signals` route after one deploy cycle of zero traffic.
- Parallel: yes (after Task A — both touch platform-copilot agent spec).

### Task C — `Ctrl+K` command palette

- File: `components/layout/CommandPalette.tsx` (new client component)
- File: `lib/command-palette/registry.ts` (commands registry)
- Change: a `cmdk`-style modal triggered by `Ctrl+K` / `Cmd+K`. Three command groups:
  1. **Navigate** — every nav entry + business slugs + recent issues
  2. **Dispatch** — invoke an agent ("/dispatch platform-copilot fix the codex pill")
  3. **Settings** — toggle theme, sign out, etc.
- Mounted in the protected layout so every route has it.
- Parallel: yes — pure UI, no schema dependencies.
- New devDep: `cmdk` (~12kB)

### Task D — Agent profiling page

- File: `app/(protected)/agents/[slug]/page.tsx` (new route)
- Change: per-agent detail surface showing:
  - `tools:` list + descriptions (from `.claude/agents/<slug>.md` frontmatter)
  - Recent runs (last 20 from `runs` table) with duration + cost
  - System prompt snippet (truncated for privacy; full link to source file)
  - Runtime (claude-gateway / codex-gateway / mcp adapter)
  - Heartbeat schedule (from cron-job.org if applicable)
- New `/agents` index lists all agents in `agent_library` table.
- Parallel: yes.

### Task E — Heartbeat scheduling visualisation

- File: `components/heartbeat/HeartbeatTimeline.tsx`
- Change: horizontal timeline showing the next N scheduled heartbeats (each agent's cron + the last fire time + duration). Real-time-ish via the existing `/api/cron/health` polling. Mounted on `/agents/<slug>` and `/dashboard`.
- Parallel: yes (after Task D — surfaces inside agent profile).

### Task F — Bento-grid Mission Control

- File: `app/(protected)/dashboard/page.tsx` (refactor)
- Change: replace the current vertical list with a bento-grid layout per Paperclip's data-dense aesthetic:
  - Top-left tile: aggregate spend (24h / 7d / 30d) with sparkline
  - Top-right tile: pending approvals count + first 3
  - Mid-left: heartbeat timeline (the component from Task E)
  - Mid-right: recent run_events (compact)
  - Bottom: per-business compact tiles (sub-set of the /businesses tiles)
- Preserves existing alert + KPI logic; just re-arranges.
- Parallel: yes (depends on Task E).

### Task G — Visual style sweep across remaining pages

- Files: all `app/(protected)/**/page.tsx`
- Change: apply consistent `rounded-2xl` / `rounded-xl` to all card containers, monospace font (`font-mono`) for any USD / token / metric value, ensure violet accent is reserved for primary actions (no other accent colours).
- Parallel: yes (purely cosmetic).

## Verification per phase

After each task:
- `npx tsc --noEmit` clean
- `npm run check:retry-storm` clean
- `npm run check:sentry-config` clean
- Browser smoke at 375px + desktop
- For Task A: end-to-end provisioning dry-run in dev — does the agent ask the right questions, does the provisioning approval contain the right items?
- For Task B: invoke `signals_briefing` from platform-copilot chat, verify it returns recent signals
- For Task C: `Ctrl+K` opens the palette on every protected route
- For Task D: `/agents/platform-copilot` renders without errors
- For Task E: heartbeat timeline shows the last 24h of fires

## Timeline (against today)

| Task | Est. effort | Depends on |
|---|---|---|
| A — create_business | 2 days | this PR-273 merged |
| B — signals_briefing skill | 1 day | A (shares agent spec changes) |
| C — Ctrl+K palette | 1 day | none |
| D — Agent profiling | 1 day | none |
| E — Heartbeat viz | 0.5 days | D |
| F — Bento Mission Control | 1 day | E |
| G — Style sweep | 0.5 days | none |
| **Total** | ~7 days | — |

Tasks C, D, G can run in parallel today. A + B are sequential. F depends on D + E.

## Risks

- **`create_business` provisioning is destructive** — must be approval-gated end-to-end. The agent spec mandates one `approval-request` per Coolify call, per Cloudflare call, per Composio seed. NEVER batches.
- **`Ctrl+K` keyboard hijack** — must NOT swallow `Ctrl+K` when the operator is mid-input in a textarea / contentEditable. Check `e.target.tagName` before opening.
- **Agent profiling page exposes system prompts** — truncate or hide entirely when the agent is marked `transferable: false` in frontmatter (the spec is private to the org).
- **Bento dashboard mobile responsiveness** — bento grids are notoriously hard at 375px. Stack tiles vertically below `md` breakpoint.

## Progress (as of 2026-05-22)

### Completed in PR-273

- [x] `/inbox` page with All / Approvals / Mine / Recent filter tabs
- [x] Sidebar nav restructure: Inbox replaces Approvals + Signals + Ideas entries
- [x] Sidebar visual polish: rounded-r-2xl edge, gradient logo box, shadow
- [x] This plan doc

### Remaining (Tasks A-G above)

- [ ] Task A — create_business chat-consultant agent
- [ ] Task B — signals_briefing skill
- [ ] Task C — Ctrl+K command palette
- [ ] Task D — Agent profiling page
- [ ] Task E — Heartbeat scheduling visualisation
- [ ] Task F — Bento-grid Mission Control
- [ ] Task G — Visual style sweep across remaining pages

### Blockers / Open Questions

- Decide whether `create_business` provisions Coolify containers IMMEDIATELY (during the chat) or stages them as a pending provisioning request for the operator to trigger via Coolify UI. Auto-provisioning is the higher-autonomy answer but riskier — the agent should not silently spin up infrastructure that costs money.
- Decide whether `Ctrl+K` dispatch goes through platform-copilot's chat session (so the operator sees the run in the chat history) or fires the agent directly (faster, but no audit trail).
- After Task A ships and the operator confirms zero traffic to `/idea` and `/signals` for 7 days, file a follow-up to remove the legacy routes + redirect their URLs to the new surfaces.
