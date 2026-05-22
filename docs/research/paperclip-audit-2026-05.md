# Paperclip Audit — May 2026

- **Audited:** [`paperclipai/paperclip`](https://github.com/paperclipai/paperclip) @ commit `c91a06232625` (master, 2026-05-20)
- **Stars at audit:** 67,041 · **Forks:** 12,297 · **License:** MIT · **Primary lang:** TypeScript
- **Companion repo:** [`paperclipai/companies`](https://github.com/paperclipai/companies) — template catalog
- **Author:** Claude Opus 4.7 — Nexus repo scope `pinnacleadvisors/nexus`
- **Source of decision:** `task_plan-paperclip-absorption.md` Phase 1

## 0. TL;DR — what the audit actually changed

1. **`paperclipai/companies` has NO license** (repo metadata `license: null`). The plan's "port the COMPANY.md + agents/ + skills/ + .paperclip.yaml format" is fine as a *recipe* (format is non-copyrightable), but we **cannot copy template contents**. Every seeded company must be original.
2. **Plan's data model is partly wrong.** Paperclip does NOT have a single flat `goals` table peer-to-`issues`. The hierarchy is `Initiative → Project → Milestone → Issue → Sub-issue` (5 levels), with `issues.goalId` as an optional FK to a separate `goals` table that exists but is not the primary work-breakdown carrier. See §3.
3. **Plan's file paths are wrong.** Schema lives in [`packages/db/src/schema/*.ts`](https://github.com/paperclipai/paperclip/tree/master/packages/db/src/schema) (Drizzle ORM), not `server/db/`. Server is a single `server/src/` tree, not `server/api/heartbeats/`, `server/api/budgets/`, `server/api/approvals/` as plan claimed. Audit corrects each citation below.
4. **Paperclip already has Claude Max + Codex Pro subscription panels** ([`ui/src/components/ClaudeSubscriptionPanel.tsx`](https://github.com/paperclipai/paperclip/blob/master/ui/src/components/ClaudeSubscriptionPanel.tsx), `CodexSubscriptionPanel.tsx`). The plan's "self-hosted Claude-gateway draining Max 20x" is **no longer a moat** — it's table stakes. Nexus's `services/claude-gateway/` should stay, but adopt Paperclip's UI affordances around plan-billing visibility.
5. **Paperclip's headline architectural concept** is the **adapter system** (`process | http | claude_local | codex_local | opencode_local | pi_local | cursor | openclaw_gateway | hermes_local` + plugins). Adapter interface: `invoke / status / cancel`. This is the single most important absorbable abstraction — it's how Paperclip stays runtime-agnostic and is what lets Nexus *also* be runtime-agnostic. See §6.
6. **Recommended Coolify decision:** Paperclip's "one instance, many companies" model is genuinely cleaner. However, retiring per-business Coolify containers needs a separate ADR — they exist for Composio MCP-set isolation per niche, and Paperclip's adapter model doesn't replace that. Recommendation: **keep Coolify containers, absorb the adapter pattern alongside.** See §10.

## 1. License & legal posture

| Repo | License | Star count | Implication |
|---|---|---|---|
| `paperclipai/paperclip` | **MIT** | 67,041 | Can read, fork, copy patterns with attribution |
| `paperclipai/companies` | **None** (no LICENSE file, repo metadata `license: null`) | 638 | **Cannot copy templates.** Format/recipe is fine; contents are not. |

**Required action before Phase 4:** an ADR-008 (separate from ADR-007) documenting attribution language for absorbed patterns. NPM-style: include `"This project absorbs patterns from paperclipai/paperclip (MIT) ..."` in `package.json` `notice` field + a NOTICE.md at repo root if we port any code verbatim.

## 2. Confirmed data model (verified against schema files)

[`packages/db/src/schema/`](https://github.com/paperclipai/paperclip/tree/master/packages/db/src/schema) has **50+ tables**. The ones that map to the plan's Phase 2 migrations:

| Paperclip schema file | What it tracks | Nexus mapping |
|---|---|---|
| `companies.ts` | First-class company entity (id, name, createdAt) | Extend `business_operators` — add `mission`, `board_members JSONB`, `parent_org_id` (TBD per SPEC) |
| `agents.ts` | Agent rows, org-position, adapter type+config, status | New `agents` table — `(company_slug, role, reports_to, adapter_type, adapter_config JSONB, status)` |
| `goals.ts` | Goals as standalone entities (linked from issues via `goalId`) | New `goals` table (plan was right) |
| `issue_*.ts` (12 files) | issues, sub-issues, comments, documents, approvals, attachments, labels, read_states, inbox_archives, execution_decisions | New `issues` + `issue_comments` + (defer the rest) |
| `approvals.ts`, `approval_comments.ts`, `issue_approvals.ts` | Unified approval objects (separate from issue execution) | New `approvals` table — replaces `business_operators.approval_gates` JSONB |
| `heartbeat_runs.ts`, `heartbeat_run_events.ts`, `heartbeat_run_watchdog_decisions.ts` | Heartbeat execution log, watchdog reconciliation | Map to existing `runs` + `run_events` tables — **NO new tables needed** |
| `budget_policies.ts`, `budget_incidents.ts`, `cost_events.ts`, `finance_events.ts` | Budgets are policy rows + incidents + per-call cost events | Extend `experiment_metrics` (cost_events shape) + new `budget_policies` |
| `agent_wakeup_requests.ts` | One-shot scheduled wake (`monitor.nextCheckAt`) | New `agent_wakeup_requests` table — required for "stop heartbeat, wake at T" semantics |
| `activity_log.ts` | Append-only activity stream | Map to existing `run_events` |
| `company_skills.ts` | Per-company skill registry | New table — `(company_slug, skill_slug, source: 'builtin' | 'plugin' | 'imported')` |
| `execution_workspaces.ts`, `environments.ts`, `environment_leases.ts` | Per-task isolated workspaces (worktrees, dev servers, leases) | **Defer** — Nexus has Coolify containers; revisit when adapter system lands |

**Critical schema invariants observed:**
- **Single assignee.** `issues.assigneeAgentId` and `issues.assigneeUserId` are mutually exclusive — hard invariant per [`doc/execution-semantics.md` §2](https://github.com/paperclipai/paperclip/blob/master/doc/execution-semantics.md). Nexus should match this.
- **`checkoutRunId` vs `executionRunId`** — issue-ownership lock vs active-run pointer. Two distinct concepts. The plan's "atomic checkout via `SELECT ... FOR UPDATE SKIP LOCKED`" maps to claiming `checkoutRunId`.
- **`blockedByIssueIds`** is the dependency relation; `parentId` is structural. Plan's "goal-ancestry" should use `parentId`, NOT blockers.
- **Status categories are fixed** (`triage | backlog | unstarted | started | completed | cancelled`) but per-team state names are configurable. Worth absorbing — replaces our `tasks.column_id` enum.

## 3. Task hierarchy — corrected

Plan said: company → project → goal → parent → issue (4 levels).

Paperclip's actual model (from [`doc/TASKS.md`](https://github.com/paperclipai/paperclip/blob/master/doc/TASKS.md)):

```
Workspace
  Initiative          (roadmap-level, span quarters)
    Project           (time-bound deliverables)
      Milestone       (stages within a project)
        Issue         (the unit of work)
          Sub-issue   (broken down under a parent issue)
```

Plus optional `issues.goalId` cross-link to `goals` table.

**Implication for Phase 2:** the plan's single `0NN_goals.sql` migration is incomplete. Need either:
- (a) **All five levels** as separate tables (matches Paperclip but very heavy), or
- (b) **Single `issues` table with `level` enum** + `parent_id` self-FK (one table, recursive query for the chain), or
- (c) **Issues only + goals** (plan's current shape — works but loses Initiative/Project/Milestone). Pragmatic minimum.

**Recommendation:** option (c) as Phase 2 MVP. Defer Initiative/Project/Milestone to a Phase 5 expansion. The "all work traces to goal" property only needs `issues.parent_id` + `issues.goal_id`.

## 4. Heartbeat model

Plan said: "audit `server/api/heartbeats/` — cron syntax, concurrency, catch-up policies."

**Reality:** there is no `server/api/heartbeats/` directory. Heartbeat is a **protocol, not a runtime** ([`doc/SPEC.md` §4](https://github.com/paperclipai/paperclip/blob/master/doc/SPEC.md#4-heartbeat-system-draft)). Implementation lives across:
- `packages/db/src/schema/heartbeat_runs.ts` (run rows)
- `packages/db/src/schema/heartbeat_run_events.ts` (per-run event log)
- `packages/db/src/schema/heartbeat_run_watchdog_decisions.ts` (recovery actions)
- `packages/db/src/schema/agent_wakeup_requests.ts` (scheduled one-shot wakes)
- `server/src/services/` and `server/src/adapters/` (the actual scheduler and adapter dispatch)

**Verified heartbeat semantics:**
- Adapter interface is **3 methods**: `invoke(agentConfig, context?) → void`, `status(agentConfig) → AgentStatus`, `cancel(agentConfig) → void`.
- **Pause is graceful**: signal current execution → grace period → force-kill on timeout → stop future heartbeats. Plan should mirror this for the operator's "pause agent" affordance.
- **Catch-up policy:** explicit "stranded-work reconciliation" via `heartbeat_run_watchdog_decisions` + explicit recovery actions ([`execution-semantics.md` §7](https://github.com/paperclipai/paperclip/blob/master/doc/execution-semantics.md)). This is more sophisticated than Nexus's current `run_events` log. Worth absorbing in Phase 4.

**No `cron` field in heartbeat schema** — schedule is per-agent, encoded in adapter config or `agent_wakeup_requests`. Nexus's per-business `daily_cron_local_hour` on `business_operators` is too coarse and should be replaced with per-agent wakeups.

## 5. Approval / governance flow

Verified tables: `approvals.ts`, `approval_comments.ts`, `issue_approvals.ts`, `board_api_keys.ts`, `instance_user_roles.ts`, `company_memberships.ts`, `invites.ts`.

**Approval is decoupled from issue execution.** An issue moves to `in_review` while an `approvals` row tracks the pending gate, with `approval_comments` for back-and-forth. This is cleaner than our `business_operators.approval_gates` JSONB string-prefix list.

**Nexus mapping:** the 5-category gate matrix (`niche_pick | domain_purchase | first_n_posts | paid_saas_signup | pricing_change`) stays as the **type taxonomy** for approval rows, NOT as an opaque approval_gates JSONB blob. Each gate becomes an `approvals.type` value.

**UI:** [`ui/src/pages/Approvals.tsx`](https://github.com/paperclipai/paperclip/blob/master/ui/src/pages/Approvals.tsx) (inbox) + [`ui/src/pages/ApprovalDetail.tsx`](https://github.com/paperclipai/paperclip/blob/master/ui/src/pages/ApprovalDetail.tsx) + [`ui/src/components/ApprovalCard.tsx`](https://github.com/paperclipai/paperclip/blob/master/ui/src/components/ApprovalCard.tsx) + `ApprovalPayload.tsx`. Port the card/inbox layout; keep Nexus's 5-category typing.

## 6. Adapter architecture — the biggest single absorbable concept

**Built-in adapters in Paperclip:**

| Adapter | Mechanism |
|---|---|
| `process` | Execute child process |
| `http` | HTTP request to external runtime |
| `claude_local` | Local Claude Code session |
| `codex_local` | Local Codex CLI |
| `gemini` / `opencode_local` / `pi_local` / `cursor` | Other local coding tools |
| `openclaw_gateway` | OpenClaw remote agents — **already a first-class adapter** |
| `hermes_local` | Local Hermes process |
| Plugin adapters | Dynamic via [`adapter-plugin.md`](https://github.com/paperclipai/paperclip/blob/master/adapter-plugin.md) |

**Nexus mapping:**

| Nexus runtime today | Becomes adapter type |
|---|---|
| `services/claude-gateway/` | `claude_gateway` (Nexus-flavoured Paperclip `http` adapter) |
| `services/codex-gateway/` | `codex_gateway` (per ADR 002) |
| Per-business Coolify container | `coolify_business` adapter — wraps the existing `lib/coolify/client.ts` API |
| n8n workflows | `n8n` adapter — `invoke = POST /webhook/<id>`, `status = GET /executions/<id>`, `cancel = POST /executions/<id>/stop` |
| Inngest functions | `inngest` adapter |

**Phase 4 win:** unifying these behind a single adapter abstraction means the strategist (`solopreneur-loop`) emits adapter-agnostic dispatches and the dispatcher routes them — exactly the pattern in `/api/n8n/dispatch` and `/api/claude-session/dispatch` today, but unified. Risk: large refactor. Reward: Paperclip's plugin ecosystem becomes available to Nexus (anyone can write a new adapter without touching core).

## 7. UI structure to absorb

Confirmed page list ([`ui/src/pages/`](https://github.com/paperclipai/paperclip/tree/master/ui/src/pages)):

Top-tier (port first): `Companies.tsx`, `Dashboard.tsx`, `DashboardLive.tsx`, `Approvals.tsx`, `ApprovalDetail.tsx`, `Inbox.tsx`, `Issues.tsx`, `IssueDetail.tsx`, `MyIssues.tsx`, `Agents.tsx`, `AgentDetail.tsx`, `Goals.tsx`, `GoalDetail.tsx`, `Costs.tsx`, `Activity.tsx`.

Components to port (top-tier, [`ui/src/components/`](https://github.com/paperclipai/paperclip/tree/master/ui/src/components)): `ApprovalCard.tsx`, `ApprovalPayload.tsx`, `BudgetIncidentCard.tsx`, `BudgetPolicyCard.tsx`, `BillerSpendCard.tsx`, `ActiveAgentsPanel.tsx`, `AgentConfigForm.tsx`, `AgentProperties.tsx`, `CommentThread.tsx`, `CompanySwitcher.tsx`, `BreadcrumbBar.tsx` (likely IssueAncestry equivalent), `ActivityRow.tsx`.

**Plan's `BudgetMeter` naming is wrong** — actual files are `BudgetIncidentCard`, `BudgetPolicyCard`, `BillerSpendCard`. There's no single "BudgetMeter" — the concept is split across three views. Update Phase 3 atomic tasks accordingly.

**Already-existing Nexus components that should NOT be duplicated:** `components/board/*` (port to `components/issues/*` but preserve patterns), `components/dashboard/AgentTable.tsx` (extend), `components/dashboard/KpiGrid.tsx` (extend).

## 8. Subscription billing — Paperclip already does this

[`ui/src/components/ClaudeSubscriptionPanel.tsx`](https://github.com/paperclipai/paperclip/blob/master/ui/src/components/ClaudeSubscriptionPanel.tsx) and `CodexSubscriptionPanel.tsx` exist. Paperclip surfaces Claude Max + Codex Pro plan usage in its UI.

**Effect on the "moat" table in the plan:** "Self-hosted Claude-gateway draining Max 20x" is no longer differentiating. What still differentiates:
- USD/day pre-dispatch kill switch (`lib/cost-guard.ts`) — Paperclip has budget *policies* + *incidents* but the audit didn't confirm a pre-dispatch hard stop. Worth a second read of `server/src/services/` to verify.
- Composio 10K-integration MCP — Paperclip's plugin system is much smaller (verified at `packages/plugins/` — appears <20 plugins as of audit commit).
- 5-category domain-specific gate matrix — Paperclip approvals are generic; ours are typed.
- memory-hq knowledge graph — Paperclip has `documents.ts` + `document_revisions.ts` but no query-graph equivalent.
- `solopreneur-loop` strategist + auto-pivot — Paperclip schedules, doesn't decide.

## 9. Plan corrections (point-by-point)

| Plan claim | Reality | Action |
|---|---|---|
| `server/db/` schema | `packages/db/src/schema/*.ts` (Drizzle) | Fix every doc reference |
| `server/api/heartbeats/` | No such directory; logic split across `server/src/services/` + `server/src/adapters/` | Re-cite |
| `server/api/budgets/` | No such directory; `budget_policies.ts` + `budget_incidents.ts` schemas drive a budgets service | Re-cite |
| `server/api/approvals/` | No such directory; `approvals.ts` schema drives an approvals service | Re-cite |
| Single `goals` table replaces hierarchy | Hierarchy is 5 levels (`Initiative→Project→Milestone→Issue→Sub-issue`) + cross-link `goalId` | Phase 2 keeps `goals` table, adds `issues.parent_id` self-FK |
| `BudgetMeter` component | Split into `BudgetIncidentCard` / `BudgetPolicyCard` / `BillerSpendCard` | Update Phase 3 atomic tasks |
| K-Dense Science Lab has 54 agents / 177 skills | Template exists at `paperclipai/companies/kdense-science-lab/` but **NO license** — cannot copy contents | Phase 4: mimic format only, original content |
| Self-hosted Claude-gateway is a moat | Paperclip already has `ClaudeSubscriptionPanel.tsx` | Remove from moat list; replace with "Composio 10K-integration breadth" |
| Paperclip is BYOK | Paperclip has plan-billed subscription panels for Claude + Codex | Update plan §Capability moat |

## 10. Decision — per-business Coolify containers

**Recommendation: keep them, absorb the adapter abstraction alongside.**

Reasoning:
- Coolify containers exist to isolate per-business MCP sets (via `lib/businesses/mcp-manifest.ts`). Paperclip's adapter system is about *runtime* (process/http/local-CLI), not about *toolset isolation*. Different problem.
- Paperclip's `environments.ts` + `execution_workspaces.ts` + `environment_leases.ts` are closer to our worktree-per-task pattern (`docs/runbooks/git-multi-agent-collaboration.md` §worktree-pattern) than to our per-business gateway pattern. Two different concerns.
- The "one instance, many companies" simplification works when companies are runtime-isolated by adapter config, not by toolset. Nexus's value is **toolset breadth** (Composio's 10K integrations). Containers stay; the **adapter layer becomes the routing fabric over top of them**.
- Escape hatch already exists (`DISABLE_PER_BUSINESS_GATEWAY=1`, `BUSINESS_GATEWAY_BYPASS_SLUGS`). If a future ADR proves single-instance + adapters is genuinely better, the off-ramp is one env var.

**This decision is reversible.** Phase 4 can re-evaluate after the adapter layer lands.

## 11. Recommended next-phase scope (replaces plan's Phase 2 atomic tasks)

The plan's Phase 2 migration list is largely correct but should be reduced to the minimum that unblocks UI absorption:

| Order | Migration | What it adds | Fail-soft hook |
|---|---|---|---|
| 1 | `046_companies_promotion.sql` | `business_operators.mission TEXT NULL`, `board_members JSONB DEFAULT '[]'`, `parent_org_id TEXT NULL` | `lib/business/insert.ts` strip-on-missing-column |
| 2 | `047_goals.sql` | New `goals(id, business_slug, title, success_criteria, parent_goal_id, status)` | Read-only fallback (UI hides Goals tab) |
| 3 | `048_issues.sql` | New `issues(id, business_slug, goal_id, parent_id, assignee_agent, assignee_user, status, status_category, body, created_at, ...)` + `issue_comments` | Defer — wait until §11.1 spike confirms data fits Paperclip's invariants |
| 4 | `049_run_events_ancestry.sql` | Add `goal_id`, `issue_id` columns to `run_events` | Existing `insertTask`-style strip-on-missing pattern |
| 5 | `050_approvals_first_class.sql` | New `approvals(id, business_slug, type, status, payload, created_by_agent, created_at, decided_at)` — replaces JSONB approval_gates list | Old `approval_gates` JSONB stays — read both, prefer table when present |

**§11.1 spike (recommended before migrations land):** prototype Paperclip's `checkoutRunId / executionRunId` lock semantics in TS against a throwaway local Supabase to verify `SELECT ... FOR UPDATE SKIP LOCKED` over our PgBouncer config. The Coolify scope migration (043_coolify_scope.sql) hit similar PgBouncer quirks; do not re-discover.

## 12. What this audit deliberately does NOT do

- Audit Paperclip's `evals/` directory (out of plan scope).
- Audit Paperclip's `cli/` directory (Nexus has no CLI to absorb into).
- Compare Paperclip's `realtime/` (websockets) against Nexus's polling pattern — separate ADR if we want to switch.
- Inspect `paperclipai/companies/<each-template>/` beyond verifying license status — content is non-copyable, only the format spec from `doc/AGENTCOMPANIES_SPEC_INVENTORY.md` matters.
- Verify the "67K stars" + "March 2026 launch" claims beyond `gh api` metadata (date `created_at: 2026-03-02`, current star count returned by API).

## 13. Citations index

All citations are to the audit commit (`c91a06232625`, master, 2026-05-20). Re-pin to a later commit if Phase 2 starts more than ~4 weeks after this audit.

- [README.md](https://github.com/paperclipai/paperclip/blob/master/README.md)
- [doc/PRODUCT.md](https://github.com/paperclipai/paperclip/blob/master/doc/PRODUCT.md)
- [doc/SPEC.md](https://github.com/paperclipai/paperclip/blob/master/doc/SPEC.md)
- [doc/TASKS.md](https://github.com/paperclipai/paperclip/blob/master/doc/TASKS.md)
- [doc/DATABASE.md](https://github.com/paperclipai/paperclip/blob/master/doc/DATABASE.md)
- [doc/execution-semantics.md](https://github.com/paperclipai/paperclip/blob/master/doc/execution-semantics.md)
- [doc/OPENCLAW_ONBOARDING.md](https://github.com/paperclipai/paperclip/blob/master/doc/OPENCLAW_ONBOARDING.md) (not deeply audited; quick-skim only)
- [adapter-plugin.md](https://github.com/paperclipai/paperclip/blob/master/adapter-plugin.md)
- [packages/db/src/schema/](https://github.com/paperclipai/paperclip/tree/master/packages/db/src/schema) (50+ tables)
- [ui/src/pages/](https://github.com/paperclipai/paperclip/tree/master/ui/src/pages) (~40 pages)
- [ui/src/components/](https://github.com/paperclipai/paperclip/tree/master/ui/src/components) (many; subset cited inline)
