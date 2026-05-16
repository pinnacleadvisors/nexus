# Platform UI audit — 2026-05-16

> Ran via Claude Code + `@playwright/mcp` attached over CDP to a logged-in Chrome session against the preview deployment at `nexus-6jwod1aub-pinnacleadvisors-projects.vercel.app`. Read-only pass — no state mutations. ~9 surfaces walked: `/settings`, `/settings/accounts`, `/dashboard`, `/board`, `/businesses`, `/manage-platform`, `/tools`, `/graph`, sign-in redirect.
>
> This is the durable artifact behind the chat audit; per-finding atoms also land in memory-hq under `mocs/nexus-ai-tester-findings`.

## Executive summary

The platform's **bones are right**. Mission Control + Pipeline + Knowledge Graph + Dev Console give a single operator the four screens they actually need to run a fleet of business experiments, and the platform-copilot ("Nexus builds Nexus — describe a change, approve the plan, dispatch to Claude Code") is the most distinctive surface — nothing else in the indie-hacker tool category has anything like it.

The two **p1 problems** are mechanical, not strategic: (1) `/api/gateway-status` is being polled twice per page because the spend chip is mounted twice in the DOM on every protected page, and (2) Clerk is still running on development keys against the deployed URL (`Clerk has been loaded with development keys` warning on every page). Both fixable in <2 hours; both compound every page load.

The **biggest UX win** is consolidating `/settings/accounts` — today the same logical platform (Slack, GitHub, Stripe, Vercel) is rendered in three places on one page (top "Connected" list, per-category list, sidebar disabled-button), and Vercel shows both "CONNECTED" and a "paste key" form simultaneously. One scope-aware row per platform with badges for each connected scope cuts the cognitive load by ~3×.

The **biggest strategic gap** toward "CEO of an autonomous workforce" is the lack of a fleet-level view — `/businesses` lists 2 cards with Open Chat / Manage buttons, but no business's run state, KPI delta, or pending-approval count is visible without clicking in. A single screen answering "where do I need to steer right now?" is what the CEO role demands and isn't there yet.

---

## Section 1 — Bugs (sorted by severity)

### P1

**1. `/api/gateway-status` polling storm — spend chip mounted twice per page.** Network capture on `/settings` shows 11 GETs to `/api/gateway-status` in a single page load. The accessibility tree confirms the spend chip ("Max (free) · Queue: 0 · Today: $0.00 / $25.00") is rendered twice in the DOM (refs `e92` + `e131` on `/settings`; `e271` + `e277` on `/dashboard`). Two mounts → two hooks → two `setInterval` pollers. Per AGENTS.md retry-storm checklist, this should use `usePollWithBackoff` and live in a single layout-level mount, not be duplicated per page.
   - **Fix**: hoist the chip into the protected layout (one mount), pass via context. Replace `setInterval` with `usePollWithBackoff(fetcher, { intervalMs: 5000 })`.

**2. Clerk development keys live in production deployment.** `[WARNING] Clerk: Clerk has been loaded with development keys. Development instances have strict usage limits…` on every page. The user-facing impact is rate limits on auth + Clerk explicitly says don't use in production. If this is intentional (single-owner platform, no real customers) it's still p2 — but it's p1 if anything outside the operator's own session is intended to hit prod.
   - **Fix**: rotate `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` to production instance values in Doppler. Confirm `proxy.ts` allowlist still works.

**3. React Error #418 (hydration mismatch) on every protected route.** Every navigation logs one minified React error #418 — "HTML hydration failed because the initial UI does not match what was rendered on the server." Universal across pages so the offender is in the shared layout (sidebar or header). Common cause: a `Date.now()` / `Math.random()` / cookie-conditional render in a server component.
   - **Fix**: grep `app/(protected)/layout.tsx` and sidebar/header for non-deterministic SSR. Likely candidate: time-relative strings ("10d ago") rendered server-side vs client-side mismatch — wrap in `'use client'` + render only after mount, OR use `next/dynamic` with `ssr: false`.

### P2

**4. `##nexus-inkbound` and `##nexus-ledger-lane` — double-hash in Slack channel names** on `/businesses`. Slack channels are `#channel`, not `##channel`. If the operator ever wires a digest webhook to those names, posts will fail with channel-not-found.
   - **Fix**: search `lib/businesses/` + Supabase `businesses` table for `##nexus-` and replace with `#nexus-`.

**5. Vercel shows "CONNECTED" and a "paste key" form simultaneously** on `/settings/accounts`. Conflicting UI state — the operator can't tell if they're connected or not. Probably caused by the per-category list (Developer section) rendering the paste form unconditionally while the top Connected list shows the active connection.
   - **Fix**: when a platform is connected, the per-category tile should show "Manage / Rotate key" not the bare paste form.

**6. Knowledge graph: 13 nodes / 0 edges.** Graph stats: 13 Nodes · 0 Edges · 13 Clusters · 2 Types. Twelve of fourteen supported node types (Project, Milestone, Agent, Tool, Workflow, Repository, Prompt, Skill, Map of Content, Entity, Atomic note, Memory doc) have zero instances. Two types populated (Business=2, Asset=11). With 0 edges, the marketed value prop ("Agents can query this graph for context before tasks — reducing token usage by up to 70×") doesn't apply yet — there's nothing to traverse.
   - **Fix**: backfill `mol_edges` (or whatever stores relationships) from board cards → business + MOC. Surface a "1-click rebuild" button (it exists — labeled "Rebuild" at e153 — verify it works).

### P3

**7. Date format inconsistent.** `/settings/accounts` shows `12/05/2026` (ambiguous DD/MM vs MM/DD); `/dashboard` shows `10d ago`. Pick one: relative for everything <30 days, ISO `YYYY-MM-DD` thereafter.

**8. Visual language inconsistency.** Headings switch between `> Connected Accounts` (terminal-arrow) and `// Connected` (code-comment slash) and plain `Mission Control` (no decoration). The terminal motif clashes with the iOS-liquid-glass panes the same pages adopt. Pick one identity — see Section 5.

**9. Context-less floating `$0` / `$0.01` element** at the bottom of `/dashboard` (ref `e264`) and `/settings` (ref `e171`). A single dollar amount with no label. Looks like a debug leftover or an aria-live region for the cost meter that's leaking visible text.

**10. Board cards are walls of text.** All 11 backlog cards show their full setup-checklist body inline — multi-paragraph instructions with 10+ steps inside each card. A card should be a summary + click-to-detail; today the operator has to scroll vertically per card to reach the next.

**11. Backlog duplication.** 8 of 11 cards are variants of "[n8n build] AI Digital Product Funnel" / "[n8n maintain] AI Tools Digital Products" with near-identical setup checklists. Idea-generation re-ran and didn't dedupe.

**12. `[DOM] Password field is not contained in a form`** warning on `/settings/accounts` — paste-key textbox is being treated as a password field by Chrome autofill heuristics. Cosmetic; affects autofill behavior.

---

## Section 2 — Pages to merge or remove

**Merge `/settings` + `/manage-platform`.** The Settings page literally says "For development tasks, head to the dev console" — that boundary exists because Settings used to be config-only and Dev Console was chat-only. With the platform-copilot now able to edit codebase + read Vercel + flip env vars, "config" and "dev tasks" are the same surface for a single-owner operator. Recommended: fold `AI providers`, `Alerts`, `Access` into `/manage-platform` as additional top-tabs alongside Console/Research/Health/Switches/Audit. Leave `/settings/accounts` and `/settings/businesses` as standalone sub-routes since they're connection management, not platform config.

**Pick one navigation pattern in Settings.** Today: `AI providers`, `Alerts`, `Access` use `?tab=ai` query params; `Accounts`, `Businesses` use `/settings/accounts` sub-routes. Two patterns visible on the same row. Recommendation: all sub-routes (reload-survivable, bookmarkable, deep-linkable from the platform-copilot's responses).

**Collapse the 3-way platform duplication on `/settings/accounts`.** Today each platform appears in (a) top "Connected" list scoped per (admin/shared/business), (b) per-category section ("Communication", "Developer", "Commerce", "Design") as disabled "CONNECTED" buttons, (c) sidebar with the Composio OAuth/API-key paste form. Three places for the same row. Recommendation: ONE row per logical platform, with badges showing every scope it's connected to (`@admin`, `@shared`, `@inkbound`), Click → unified detail panel for that platform.

**Audit whether `/idea` + `/signals` + `/board` should fold together.** Sidebar lists Ideas → Signals → Pipeline → Knowledge as four separate top-level items, but conceptually they're one funnel (raw signal → vetted idea → backlog → knowledge atom). Worth exploring whether one `/forge` route with internal stages beats four siblings.

---

## Section 3 — Where the operator gets confused

| Surface | Confusion | Fix |
|---|---|---|
| `/settings` → "head to dev console" link | Why are these separate? | Merge per Section 2 |
| `/settings/accounts` Connected vs per-category | Same platform shown 2-3× | Consolidate per Section 2 |
| `/settings/accounts` Vercel "connected" + paste-form | Am I connected or not? | Hide paste-form when connected |
| `/board` cards | Walls of text, can't scan | Card summary + click-to-detail modal |
| `/graph` "13 nodes, 0 edges" | Where's the value? | Backfill edges + show clusters even on empty |
| Floating `$0` chips | What is this referring to? | Remove or label |
| Spend chip rendered twice on every page | Which one is authoritative? | Single mount in layout |

---

## Section 4 — User flow evaluation

**Today's implicit operator journey** (inferred from sidebar order):
1. `/dashboard` → today's activity at a glance
2. `/businesses` → which business needs attention
3. `/businesses/<slug>/chat` → talk to the business-copilot OR
4. `/manage-platform` → platform-copilot for cross-business or platform-level work
5. `/board` → what's queued
6. `/settings/accounts` → fix a broken connection

What's strong: the "talk to the copilot" surfaces are first-class. What's weak: there's no obvious "I have a new idea right now" entry point from `/dashboard` — Ideas/Forge is in the sidebar but not surfaced where the operator's eyeballs land first.

**Recommendation**: add a primary CTA on `/dashboard` for "Spin up a new idea" that lands on `/idea` (or wherever the Forge chatbot lives). And a secondary CTA for "Promote idea → business" that takes a backlog card and provisions a new per-business container.

**Whole-journey friction**: there's no visible "stage" on a business. When the operator opens `/businesses/ledger-lane/chat`, they can't tell at a glance whether ledger-lane is in idea-validation, build, launched, maintain, or wind-down phase. Add a phase chip next to the business name on its chat header + on the `/businesses` card.

---

## Section 5 — UX/UI direction: Claude-Code pro + iOS liquid glass

**What's working**:
- `/settings/accounts` liquid-glass control bar (backdrop-blur, subtle gradient, inset highlight) — strongest visual moment in the platform.
- Mission Control KPI tiles — clean, breathable.
- Empty-state copy is differentiated and on-brand ("Nothing waiting. The Hive is unblocked.", "Cards arrive here when an agent ships an asset that needs your approval"). Keep this.
- Status chip pattern ("Max (free)" with colored dot + tooltip) — apply this language everywhere status is shown.

**What clashes**:
- Terminal-aesthetic headings (`> Connected Accounts`, `// Connected`) on the same pages as iOS-glass panes. Drop the decorations OR commit to terminal aesthetic for technical surfaces (Dev Console, Audit) and iOS-glass for operator surfaces (Dashboard, Businesses, Settings).
- Mixed pane treatment: some panels (Provider chain on /settings) are flat bg + border; others (Settings switcher bar) are full liquid-glass. Standardize.
- Floating context-less `$0` / `$0.01` chips at page-bottom.
- Date strings (`12/05/2026` vs `10d ago`).

**Recommendation — visual language consolidation**:

1. **One heading style**: drop `>` and `//`. Use semantic `<h1>` with iOS-style large bold + colored-mono accent character (the `>` lavender accent is good, just lose the literal `>` — replace with the lucide chevron icon or a vertical-bar gradient).
2. **Liquid-glass panes are the default**. Every content pane that's currently flat-bg + border should adopt `background: linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))` + `backdropFilter: 'blur(28px) saturate(180%)'` + `border: 1px solid rgba(255,255,255,0.10)` + the inset highlight + soft drop-shadow. This is already coded in `/settings/accounts` — extract to a shared `<GlassPane>` component.
3. **One global spend chip**, lifted to the protected layout. Mounts once, polls once, every page reads via context. Removes both the duplication bug and the visual jarring.
4. **Color system**: lavender `#a8a3ff` for accent, ink `#050508` background, off-white `#e8e8f0` text, muted `#9090b0` for secondary. Codify in `app/globals.css` `@theme inline` so component authors stop hardcoding rgba.
5. **Empty states are sacred** — already strong; just make sure every new page has copy at that bar.

---

## Section 6 — Chat / MCP / API layer (toward "Claude Code for any project/business")

**What exists today**:
- `/manage-platform/chat` (platform-copilot, admin scope MCPs)
- `/businesses/<slug>/chat` (business-copilot, scope-isolated MCPs — PR #193)
- `approval-request`, `manual-task`, `edit-plan`, `iteration-plan` typed blocks render inline as FloatingActionBar cards
- Async polling + persistent sessions + per-conversation history
- Tool budget (≥2 plausible tools per dispatch) enforced
- Health view (PR #192) surfaces run errors, cron status, Slack delivery checks
- Memory-hq + n8n MCPs co-resident in Claude Desktop for cross-MCP correlation (runbook PR #196)

**Gaps toward the "Claude Code for any project" feel**:

1. **SSE streaming**. The model status banner literally reads "SSE streaming is still deferred." Without streaming, every reply feels black-box. Top UX gap — closes it more than any other single change.
2. **Searchable + exportable history**. Chat sidebar lists prior conversations but no search, no export, no tagging. Claude Code Desktop lets you grep across all conversations.
3. **Resume + branch**. Reopening a prior chat works; "branch from this turn" doesn't. Useful for "what if I had asked it differently" exploration without polluting the linear history.
4. **Tool transcripts**. When the agent calls a Composio action or an MCP, the operator sees the synthesized reply but not the raw tool call + response. Add a collapsed `<details>Tool transcript</details>` per turn — same shape as the Anthropic API tool-use response inspection.
5. **Per-business contextual rail**. `/businesses/<slug>/chat` could surface above the input: recent run errors (last 24h), pending approvals count, KPI deltas vs target. Today this context is in the system prompt server-side but invisible to the operator.
6. **MCP healthcheck on chat load**. When the operator opens a business chat, run a lightweight `list_tools` on each scoped MCP and show "Composio: 12 tools available · n8n: 0 (connecting…) · memory-hq: 47 atoms in scope". So the operator can see what powers the agent before they ask it anything.

---

## Section 7 — Path to "CEO of an autonomous workforce"

The single-owner-CEO of a fleet of autonomous businesses needs five views that don't fully exist yet:

1. **Fleet status overview** — one row per business on `/dashboard` showing: last cycle status (green/yellow/red), 24h KPI delta, pending approvals count, agent activity heartbeat, cost-burn rate. So one glance = where do I need to steer.
2. **Cross-business approval inbox**. Today each business surfaces its own approvals. A unified inbox at `/dashboard` (or a `/approvals` route) showing every pending approval across every business, sortable by age + severity. CEO opens this first thing.
3. **Strategic vs tactical separation**. `/dashboard` is tactical (today). Add a strategic surface — `/strategy` or a tab — showing: which businesses are winning (revenue trending up), which to wind down (3 cycles stagnant per `solopreneur-loop` auto-pivot signal), which to spin up next (top backlog ideas ranked by predicted ROI). The auto-pivot eligibility should be a card, not buried in `experiment_metrics`.
4. **Idea → business pipeline visibility**. Today `/idea` → `/board` → `/businesses` are three sidebar items. Fold them into a Kanban-style pipeline: `Raw idea → Vetted → Building → Live → Maintaining → Wound down`, with cards visibly progressing through stages. The CEO sees the pipeline depth at a glance.
5. **Cost-of-fleet view**. Spend chip today is per-page-and-per-business. Need a fleet-level breakdown at `/dashboard`: "Today: $X total · $Y_a (inkbound) · $Y_b (ledger-lane) · $Z (platform overhead)". When one business is burning, the CEO sees it.

**The autonomous-workforce primitive that's still missing**: a "delegate this whole goal" surface. The platform-copilot today is great for atomic tasks ("rotate the Clerk key"). A CEO-shaped operator wants: "Here's my Q3 goal — get inkbound to $5k MRR. Plan the work, execute autonomously, surface only the decisions only I can make." Today that work is implicit in `solopreneur-loop` / `business-operator` cron cycles, but it's not visible as a goal-state on any UI. Surface goals as first-class objects with progress visible alongside the business.

---

## Section 8 — Recommended next moves (sequenced)

| # | Action | Effort | Severity |
|---|---|---|---|
| 1 | Fix `/api/gateway-status` polling storm — single mount in layout, `usePollWithBackoff` | 1-2h | p1 |
| 2 | Fix React #418 hydration on shared layout — likely time-relative SSR drift | 2h | p1 |
| 3 | Search/replace `##nexus-` → `#nexus-` in Slack channels | 5min | p2 |
| 4 | Rotate Clerk to production keys (only if launching customer-facing surfaces) | 1h | p1-if-launching, p2-otherwise |
| 5 | Consolidate `/settings/accounts` to one-row-per-platform with scope badges | 4h | p2 |
| 6 | Hoist spend chip + cost meter into the protected layout; extract `<GlassPane>` component | 4h | p2 |
| 7 | Backfill knowledge graph edges (Asset → Business, Asset → MOC) | 4h | p2 |
| 8 | Wire SSE streaming through chat poll route (largest "feels like Claude Code" gap) | ~1 week | strategic |
| 9 | Build fleet-level overview row on `/dashboard` (last cycle, KPI delta, pending approvals) | 1 day | strategic |
| 10 | Drop terminal `>` / `//` decorations from headings; standardize visual language | 1 day | polish |
| 11 | Add cross-business approval inbox | 1 day | strategic |
| 12 | Surface MCP healthcheck on chat load | 4h | UX |

**Top-3 sequencing recommendation**: (1) fix polling storm + #418 first — they're cheap and stop bleeding cost/log noise on every page load; (2) consolidate `/settings/accounts` because it's the page the operator hits most often when wiring up a new business; (3) wire SSE streaming because that's the single biggest "is this Claude Code or not" perception gap.

---

## Appendix A — Surfaces walked

`/` (redirected to `/sign-in` — confirms `proxy.ts` ALLOWED_USER_IDS gate works on root) · `/settings` · `/settings/accounts` · `/dashboard` · `/board` · `/businesses` · `/manage-platform` · `/tools` · `/graph`. Skipped: `/idea`, `/signals`, `/learn`, individual business chat surfaces (would require sending prompts which costs real LLM spend).

## Appendix B — Methodology notes

- Tool: `@playwright/mcp@latest` over CDP at `localhost:9222`, attached to dedicated Chrome profile `~/.chrome-cdp-profile`
- Auth: pre-existing Clerk session in that profile
- Per-page: `browser_navigate` → `browser_snapshot` (accessibility tree, not screenshots — far cheaper in tokens) → `browser_console_messages` → `browser_network_requests` (when relevant)
- No state mutations attempted. No chat prompts submitted (would have cost real LLM dispatches against the gateway).
- Total wall time: ~12 minutes of MCP calls.
