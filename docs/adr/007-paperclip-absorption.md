# 007 — Selective absorption of Paperclip patterns

- **Date:** 2026-05-22
- **Status:** Accepted

## Context

[`paperclipai/paperclip`](https://github.com/paperclipai/paperclip) (MIT, 67K stars at audit time, launched 2026-03-02) ships a credible open-source implementation of ~70% of Nexus's platform layer: companies-as-first-class, goal-ancestry on tasks, threaded issues with single-assignee + checkout/execution lock semantics, unified approval inbox, per-agent budget meters, agent-team templates, and a clean board-level UI.

A migration to Paperclip as runtime was evaluated and rejected — Nexus's differentiators (USD/day pre-dispatch kill switch via [`lib/cost-guard.ts`](../../lib/cost-guard.ts), Composio 10K-integration breadth via [`lib/composio/actions.ts`](../../lib/composio/actions.ts), niche→MCP manifest via [`lib/businesses/mcp-manifest.ts`](../../lib/businesses/mcp-manifest.ts), 5-category gate matrix in [`solopreneur-loop`](../../.claude/agents/solopreneur-loop.md), memory-hq knowledge graph) would require nontrivial re-implementation inside Paperclip's plugin system, and we lose control of release cadence + runtime decisions.

The Phase 1 audit ([`docs/research/paperclip-audit-2026-05.md`](../research/paperclip-audit-2026-05.md)) verified Paperclip's data model, adapter architecture, approval flow, and UI structure against the actual repo at commit `c91a06232625`. It also surfaced several plan corrections (single-`goals`-table assumption was partly wrong; "self-hosted Claude-gateway draining Max 20x" is no longer a moat — Paperclip ships `ClaudeSubscriptionPanel.tsx`; `paperclipai/companies` has NO license so we cannot copy template contents).

## Decision

**Selectively absorb Paperclip's platform abstractions and UI patterns into Nexus, without migrating runtime.**

Four phases (see [`task_plan-paperclip-absorption.md`](../../task_plan-paperclip-absorption.md) for atomic task breakdown):

1. **Audit** (this ADR; complete) — verified against the audit commit.
2. **Schema absorption** — 5 idempotent migrations (046–050) extending `business_operators` toward Paperclip's `companies` shape, adding `goals` + `issues` + `issue_comments` + `approvals` tables, adding `goal_id` / `issue_id` ancestry columns to `run_events`. Each migration paired with a fail-soft helper following the [`lib/board/insert-task.ts`](../../lib/board/insert-task.ts) pattern so app code keeps working pre-migration.
3. **UI absorption** — port `Companies` / `Approvals` / `Issues` / `Goals` / `Inbox` page structures and the `ApprovalCard` / `BudgetIncidentCard` / `BillerSpendCard` / `CommentThread` / `BreadcrumbBar` / `ActivityRow` component patterns. Mobile-responsive at 375px. Keep Nexus's chat affordances at `/forge` and `/manage-platform/chat`; adopt Paperclip's board-level abstraction as the *default* surface.
4. **Feature absorption** — adopt the **adapter architecture** as Nexus's runtime-routing fabric (`claude_gateway`, `codex_gateway`, `coolify_business`, `n8n`, `inngest` as adapter types over the existing services), introduce `lib/issues/checkout.ts` for atomic task claim, `lib/goals/ancestry.ts` for parent-walk, `lib/templates/` loader for original Nexus templates (no Paperclip template content copied).

### Alternatives considered

- **Full migration to Paperclip** (rejected) — 6-week+ migration tax, loses release-cadence control, would need to re-implement cost-guard / Composio bridge / niche-MCP-manifest / 5-category gate matrix as Paperclip plugins. Reward (free maintained platform) does not outweigh cost (loss of differentiation).
- **No absorption** (rejected) — Paperclip's clean board-level UI and adapter architecture are concrete wins that improve operator experience meaningfully; ignoring them is leaving value on the table.
- **Fork Paperclip, layer Nexus differentiators on top** (rejected) — same migration tax as full migration, plus permanent upstream merge cost. We'd rather absorb specific patterns than carry the whole codebase.

### Explicit non-goals (preserved from plan)

- Migrating to Paperclip as runtime.
- Replacing Composio with Paperclip's adapter system (Paperclip's plugin ecosystem is <20 plugins; Composio's is ~10K).
- Replacing memory-hq with Paperclip's `documents` schema.
- Replacing `solopreneur-loop` strategist with Paperclip's heartbeat scheduler (Paperclip schedules; doesn't decide).
- Building new agent runtimes — `claude-gateway` + `codex-gateway` + per-business Coolify containers stay.
- Copying any content from [`paperclipai/companies`](https://github.com/paperclipai/companies) (no license).

## Consequences

### What becomes easier

- **Multi-business as a default mental model.** Promoting `business_operators` to a `companies`-shaped entity lets `/dashboard` show a true multi-tenant view rather than today's single-business focus.
- **Goal-aware dispatch.** Every dispatched task carries its full ancestry chain (`issue → parent → goal → company`) in the prompt — the strategist can no longer drift from the North Star without it being visible in the UI.
- **Single approval inbox** at `/approvals` replaces the implicit "search Slack + the Board" workflow. Domain-typed via the existing 5-category gate matrix; not generic.
- **Adapter architecture** decouples strategist dispatch decisions from runtime routing. Adding a new runtime (a future `groq_local`, `together_remote`, etc.) is a new adapter file, not a fork of `/api/claude-session/dispatch`.

### What becomes harder

- **Schema migration discipline.** Five new tables + cross-table FKs increase the chance of a missed migration causing retry storms. Mitigation: every migration paired with a `lib/board/insert-task.ts`-style fail-soft helper, every helper covered by `npm run check:retry-storm`.
- **Memory budget.** New pages (`/companies`, `/companies/<slug>/org-chart`, `/approvals`, `/companies/<slug>/issues`) increase the surface area of polling. Existing `lib/hooks/usePollWithBackoff.ts` is the mitigation; do not introduce bare `setInterval`.
- **PgBouncer-related lock semantics.** `SELECT ... FOR UPDATE SKIP LOCKED` in `lib/issues/checkout.ts` interacts with PgBouncer transaction pooling. A spike against local Supabase is required before the migration lands (audit §11.1).
- **Maintenance debt.** We carry Paperclip-pattern absorption forward — when Paperclip evolves a pattern (e.g. new approval primitives), we need to decide each time whether to re-absorb or stay frozen.

### What must be revisited

- **Per-business Coolify containers vs Paperclip's "one instance, many companies."** This ADR keeps Coolify containers because they isolate Composio MCP sets per niche, not runtime. Revisit after Phase 4's adapter layer lands — if Composio MCP-set isolation can move into adapter config, single-instance becomes viable. Reversible: `DISABLE_PER_BUSINESS_GATEWAY=1` already exists.
- **`solopreneur-loop` heartbeat semantics.** Paperclip's per-agent `agent_wakeup_requests` with `nextCheckAt` is more granular than our current `business_operators.daily_cron_local_hour`. Phase 4 should evaluate whether to promote wakeup scheduling into the agent layer.
- **Attribution.** A NOTICE.md or `package.json#notice` field is required before any verbatim code copy from `paperclipai/paperclip`. Pattern absorption (recipe-only) does not require this, but verbatim copies do. Tracked as a Phase 2 prerequisite.
- **Audit re-pin.** This ADR cites Paperclip commit `c91a06232625`. If Phase 2 begins more than 4 weeks after this ADR, re-pin to a later commit and re-verify the changed surfaces.
