# UX consultation — autonomous-business management (2026-05-27)

> **Context**: operator asked me to research + recommend what to build next
> to improve user flow / experience and the ability for users to manage
> businesses autonomously. This document captures the current-state
> assessment + 12 prioritised recommendations.

---

## Methodology

1. **Walked the live dev surface** at 375 px mobile via Playwright. Sign-up
   through wizard → graduate → chat → board → settings.
2. **Audited the 54 protected pages** under `app/(protected)/`.
3. **Read every `task_plan-*.md`** Progress section to map shipped vs pending.
4. **Cross-referenced operator pain points** from recent session transcripts.

---

## Current state assessment — what's working

The platform is **substantially production-ready** for a single-operator
autonomous-business workflow. What works well today:

- **Wizard → simulation → graduate flow.** First-time operator creates a
  business in <5 min, sees a `NextStepsCard` (M2) with 5 actionable steps,
  and graduates only when preflight gates green.
- **Dev fixture harness.** Operator can drive the full chain
  (chat / smoke / graduate / accounts) without OAuthing into a single
  real third-party. Per-operator toggle at `/settings → Access`.
- **5-category approval gate matrix** (`niche_pick`, `domain_purchase`,
  `first_n_posts`, `paid_saas_signup`, `pricing_change`) with `/approvals`
  unified inbox. Approve / reject wired through to draft mutations.
- **Cost-guard hard stop** before every paid LLM / search / video call.
- **Mobile parity at 375 px** on the major surfaces (dashboard, businesses,
  board, settings, audit, inbox, approvals). The Playwright sweep this week
  caught the proxy.ts security gap + the SettingsTabs auto-scroll bug,
  both fixed.
- **Platform health widget** answers "is anything broken right now?" at
  the top of /dashboard.
- **Ralph-loop pattern** for every gated agent — typed `iteration-plan`,
  `edit-plan`, `edit-self`, `approval-request` blocks all parsable by the
  chat poll route.

---

## What's missing or weak

| # | Gap | Severity | Where it hurts |
|---|---|---|---|
| **G1** | **No "what changed since I last looked?"** activity stream | High | Operator with 5+ businesses has to drill into each one to see if anything happened overnight |
| **G2** | **Approval fatigue when ≥3 gates queue up at once** — current /approvals is a flat list with no batching or "approve similar" | High | Multi-business operator wakes up to 12 pending approvals; clicks through each individually |
| **G3** | **No mobile push / SMS for critical approvals** — operator manages from phone but only sees gates by opening the app | High | Time-sensitive gates (domain expiring, pricing-change auto-pivot) sit unread until next app open |
| **G4** | **Per-business cost visibility is rolled into 30-day spend** — no daily / weekly chart per biz | Medium | Operator can't see "Inkbound burned $14 yesterday" at a glance |
| **G5** | **No "operator coaching" thread** — copilot doesn't proactively suggest improvements to the operator's setup | Medium | Operator misses leverage (e.g. "your KPI targets aren't set on 2 businesses; auto-pivot won't fire") |
| **G6** | **First-time operator's home page is sparse** when they have 0 businesses — empty dashboard, empty board, empty everything | Medium | High bounce risk before they even reach the wizard |
| **G7** | **Chat sessions don't surface their own context** — operator has to scroll the session history to recall what was decided 2 weeks ago | Medium | Operator re-explains context every Monday |
| **G8** | **No bulk-action UI** for managing 5+ businesses (pause all, run smoke on all, refresh KPIs on all) | Medium | Each action is a per-business click |
| **G9** | **Performance feedback loops are 24h+ asynchronous** — analyst reads stats next day; no operator visibility into how fresh the signal is | Low | Operator wonders if the perf-analyst ran or hung |
| **G10** | **Cost cap is platform-wide, not per-business** — one runaway business can starve the others | Low | Discovered during a single sim run; happened once |
| **G11** | **Onboarding doesn't surface fixture mode prominently enough** — first-time operator may OAuth real platforms before realising they can test with fixtures | Low | Adds friction for cautious operators |
| **G12** | **No "weekly digest"** of what every business did | Low | Operator loses the forest for the trees |

---

## 12 recommendations, ranked by leverage

Each recommendation includes a one-line "why this matters" + scope estimate
+ approval-needed-before-shipping flag. Higher rank = higher operator
leverage per hour of dev work.

### R1 — Operator activity stream (`/inbox` enhancement) — 🥇 ★★★★★

**Closes**: G1, G7, partly G12. **Scope**: 1 PR (~300 LoC). **Needs approval**: no.

Extend `/inbox` from "items needing my attention" to "everything that
happened across my fleet since last check-in". Group by business, time-bucket
(last hour / today / this week), and filter by event kind (approval,
graduation, smoke completed, KPI delta).

The data is already there in `run_events` + `approvals` + `experiment_metrics`.
This is presentation work, not new infra. Highest ROI item on this list.

### R2 — Bulk approve / approve-similar — 🥈 ★★★★★

**Closes**: G2. **Scope**: 1 PR (~250 LoC). **Needs approval**: no.

`/approvals` gets a "Select all of type X" + "Approve all selected"
control. Critically: include a `similar` clustering pass that groups
by `type + business_slug + payload signature` so the operator can OK
12 "ConvertKit broadcast send" approvals in two clicks rather than 12.

Cost-guard still applies per-decision; we just batch the UI ergonomics.

### R3 — Per-business cost-cap + visualizer — 🥉 ★★★★

**Closes**: G4, G10. **Scope**: 1 PR (migration + UI, ~400 LoC). **Needs approval**: no (additive).

Two parts:
- Migration adding `business_operators.daily_cost_cap_cents` (nullable;
  null = inherits from platform-wide `USER_DAILY_USD_LIMIT`).
- `BusinessCostWidget` on `/businesses/<slug>` showing 7-day spend trend +
  today vs cap. Mirror `TodaySpendWidget` but scoped.

The cost-guard already accepts a per-business override (`checkKillSwitch`
reads `business_operators` row) — just wire it.

### R4 — Push / SMS for critical approvals — ★★★★

**Closes**: G3. **Scope**: 1 PR (~350 LoC + 2 env vars). **Needs approval**: pick provider (Twilio? OneSignal? both?).

Mobile operator manages from phone but only sees gates inside the app.
Wire web push (default) + optional SMS fallback for the 5 gate categories.
Per-category enable in `/settings → Alerts`.

**Tooling decision the operator should make**:
- Web push only (free, no PII)
- Add SMS via Twilio (~$0.0075/SMS, requires phone number in Doppler)
- Add Slack DM via Composio (free, requires Slack connected)

Default recommendation: **web push + Slack DM**. SMS optional.

### R5 — Coaching tab on /dashboard — ★★★★

**Closes**: G5, partly G11. **Scope**: 1 PR (~250 LoC). **Needs approval**: no.

A "Coach" card on `/dashboard` that the business-copilot writes to
weekly. Surfaces actionable suggestions: missing KPI targets, businesses
with no completed smoke, businesses with high cost / no revenue, fixture
mode forgotten on for 30+ days. One paragraph per insight + a primary CTA
button linking to the surface that resolves it.

Single source: `lib/coaching/insights.ts` runs server-side daily, persists
hints to `operator_coaching_hints` table, UI reads + renders.

### R6 — Weekly digest email + memory-hq atom — ★★★

**Closes**: G12. **Scope**: 1 PR (~300 LoC + 1 cron entry). **Needs approval**: confirm email destination.

Sunday 9 AM operator-local time, the platform mails the operator a digest:
- Per business: spend, revenue (if any), # approvals, # graduations, KPI deltas
- Top 3 wins, top 3 risks (clustered by insight kind)
- Link to /dashboard

Same data is also written as a memory-hq atom (`kind: weekly-digest`) so
the copilots can read prior weeks when asked "how have things gone".

Uses existing `RESEND_API_KEY`. Requires `WEEKLY_DIGEST_TO_EMAIL` (one
secret addition).

### R7 — Multi-business "fleet actions" — ★★★

**Closes**: G8. **Scope**: 1 PR (~400 LoC). **Needs approval**: no (additive).

`/businesses` gets a bulk-select checkbox column + a "Fleet actions"
dropdown: pause all, run smoke on all, refresh KPIs on all, regenerate
NextSteps for all. Each action emits one approval card to /approvals if
any business has a gate that fires.

### R8 — Operator-day-1 guided tour — ★★★

**Closes**: G6, partly G11. **Scope**: 1 PR (~500 LoC). **Needs approval**: no.

When the operator has 0 businesses AND has never dismissed the tour:
3-card welcome modal on /dashboard explaining:
1. What Nexus does (autonomous business management)
2. The simulation-first → graduate-to-prod chain
3. Fixture mode (you can test without OAuthing real platforms)

Persists "tour completed" flag in `operator_settings`. Operator can replay
via `/settings → Help → Replay tour`.

### R9 — Chat-session retrospectives — ★★★

**Closes**: G7. **Scope**: 1 PR (~250 LoC). **Needs approval**: no.

After 7 days of inactivity on a chat session, the platform writes a
1-paragraph retrospective at the top of the session (auto, via a daily
cron). Operator opens the session 2 weeks later and immediately sees
"On 2026-05-13 you decided X. Status as of 2026-05-27: …".

The retrospective generation reuses `lib/runs/failure-clusters.ts`'s
clustering pattern + the existing memory-hq atom-emission path. The
operator-coaching card (R5) and weekly digest (R6) can both consume the
same retrospectives.

### R10 — Performance signal freshness indicator — ★★

**Closes**: G9. **Scope**: tiny (~50 LoC). **Needs approval**: no.

Every KPI card on /dashboard + per-business pages gets a "last refreshed
N min ago" subtitle. When the signal is >24h stale, the card turns amber.
Reuses the existing experiment_metrics `created_at` column.

### R11 — Fixture-mode "test like a real customer" mode — ★★

**Closes**: G11. **Scope**: 1 PR (~300 LoC). **Needs approval**: no.

When fixture mode is ON, surface a small persistent badge in the top-bar
("Fixture mode — synthetic data") so the operator can never accidentally
confuse a fixture response for real. Also: a `/settings → Access → Try
walkthrough` button that runs a 30-second scripted demo against the
synthetic data.

### R12 — Mobile-first sticky operator action bar — ★★

**Closes**: ergonomic gap. **Scope**: 1 PR (~250 LoC). **Needs approval**: no.

On `/businesses/<slug>` mobile (375 px), a sticky bottom bar with the
4 most common actions: Tick simulation / Run smoke / Open chat / Graduate.
The current header buttons stack vertically and require scrolling on
small screens. Sticky bottom-bar matches the iOS/Android pattern
operators are already used to.

---

## What I'd ship next (if operator agrees)

**Top 3 by leverage**: R1 (activity stream), R2 (bulk approve), R5 (coaching tab).

All three are additive (no breaking changes, no migrations beyond the
hint table for R5), can ship as separate PRs, and combine to dramatically
improve the multi-business operator's day-to-day. Estimated total: 3
PRs across 1 day of dev work.

If you want a single bigger swing instead, **R4 (push notifications)** is
the highest mobile-impact item — the operator-manages-from-phone story is
incomplete without it. That's more like 1.5 days because of the provider
decision + the per-category opt-in UX.

---

## Anti-recommendations — things I think we should NOT build now

| Idea | Why I'd defer |
|---|---|
| New "AI council" / multi-model debate panel | The agent roster is already 30+. Adding more without measuring agent-output quality is feature creep. |
| Per-business custom UI (operator paints their dashboard) | Single-tenant for now; per-tenant customisation is multi-tenant work. |
| Real-time collaborative chat (multi-operator typing in same chat) | Multi-tenant scope; nothing forces it today. |
| Voice-control / "Hey Nexus" | Cool demo, low utility. The text chat handles every operator task in 1 message. |
| Replicate Notion / Linear / Airtable inside Nexus | The /board, /issues, /inbox surfaces already cover the workflow. Adding a fourth pseudo-Notion would dilute focus. |
| Custom theming / dark-mode toggle | One canonical dark theme is right. Operator focus is on running businesses, not picking colours. |

---

## Open questions for the operator

1. **Approve recommended top-3 (R1, R2, R5)?** I'll ship as 3 separate PRs.
2. **Push notification provider for R4** — web push only / + Slack DM / + SMS?
3. **Weekly digest destination for R6** — confirm `nguyendtrade@gmail.com`?
4. **Bulk-action defaults for R7** — should "pause all" be available, or
   strictly opt-in per-business?
5. **Day-1 tour copy for R8** — operator-authored or template?

---

## Cross-reference

- [task_plan-this-week.md](../../task_plan-this-week.md) — short-term operator priorities
- [task_plan-platform-improvements.md](../../task_plan-platform-improvements.md) — earlier gap audit
- [task_plan-mobile-copilot.md](../../task_plan-mobile-copilot.md) — mobile-specific work
- [task_plan-chat.md](../../task_plan-chat.md) — chat infra (relevant to R9)
- [memory/INDEX.md](../../memory/INDEX.md) — platform context map

---

*This document is a snapshot of the platform's UX state on 2026-05-27 as
the autonomous improvement loop drained the small/medium backlog. The
recommendations above are the next leverage band — substantive UX wins
that no single backlog item from prior task_plans was attacking.*
