# Task Plan — Autonomous Solopreneur Experiment (PDF Business)

> Layer-2 task plan per CLAUDE.md long-horizon protocol. Sister docs: ADR 002, `.claude/agents/business-operator.md`, `.claude/agents/codex-operator.md`, `docs/runbooks/per-business-container-rollout.md`.

## Goal
Stand up a fully autonomous **Claude-led solopreneur loop** running a single PDF info-product business inside its own per-business Coolify container, with strategic gates on irreversibles only. The loop must amortize the Claude 20x Max + Codex Pro subscriptions by producing real outputs continuously, and prove the pattern works before replicating to 3 parallel businesses next month.

## Success criteria
- `business` row `pdf-experiment-01` with `niche=pdf-info-products`, `money_model=digital-product`, `budget_usd=100`, `approval_gates=["niche_pick","domain_purchase","first_n_posts","paid_saas_signup","pricing_change"]`, `kpi_targets={revenue_usd_30d: 50, list_size_30d: 100}`
- Coolify container provisioned with PDF money-model MCP set + Composio OAuth tokens (X, LinkedIn, Gmail, Stripe, Beehiiv, Vercel, Cloudflare, Namecheap)
- `solopreneur-loop` agent (Claude) on multi-tick cron — 09:00 / 12:00 / 15:00 / 21:00
- `codex-maintainer` agent every 30 min for sysadmin / health / fresh-state research
- Both agents share state via `Run` events + `experiment_metrics` table
- `/dashboard/experiments/pdf-experiment-01` shows live KPIs, plan-billing ledger, kill-switch, Run timeline, gate event log
- Hard kill-switch fires on: cumulative cash spend ≥ $100 OR 7 days <$5 revenue + <50 signups (one auto-pivot allowed within budget; stagnation timer starts at "first product live", not creation)
- Multi-tenant ready — same agent specs + cron iterate by `experiment_flag`, no code changes for `-02` / `-03`

## Hard constraints
- Don't modify `business-operator.md` or `codex-operator.md` — clone/extend pattern, this is experimental
- All cash-spending actions go through Composio (`executeBusinessAction`); no raw API keys for Stripe / Namecheap / Cloudflare etc.
- Cost-guard kill-switch is **inside the loop**, not a passive monitor — overspend hard-stops the next tick
- Experiment scoped to its own `business_slug` — no leaks into existing Nexus business rows or shared Board state
- `npx tsc --noEmit` and `npm run check:retry-storm` pass before every commit
- Long-horizon write-size discipline — every atomic task fits one tool call under 300 lines / 10 KB
- All cron routes return 200 + `{ok:false, errors}` on per-business failure (retry-storm rule)

---

## Phase 1 — Explore
**Already in place:**
- `business-operator` (Claude-led daily cron orchestrator) — `.claude/agents/business-operator.md`
- `codex-operator` (GPT-5.5 sandboxed executor) — `.claude/agents/codex-operator.md`
- Per-business Coolify provisioning — `POST /api/businesses/:slug/provision`, `lib/coolify/client.ts`, `docs/runbooks/per-business-container-rollout.md`
- MCP-manifest-by-niche — `lib/businesses/mcp-manifest.ts`
- Composio OAuth broker — `lib/composio/actions.ts` `executeBusinessAction()`, `connected_accounts` (migration 033)
- Cost guard — `lib/cost-guard.ts` (per-day USD limit; needs hard kill-switch extension)
- Claude Code Agent Teams — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` flag wired by `/api/claude-session/dispatch` when `swarm: true`
- Run event log + Board — used by business-operator for state assessment
- Workflow-optimizer feedback loop — `.claude/agents/workflow-optimizer.md` + `workflow_changelog`

**Missing (everything in Phase 2):**
- `solopreneur-loop` agent spec (Claude variant of business-operator with self-improvement + auto-pivot)
- `codex-maintainer` (30-min health / research / sysadmin variant of codex-operator)
- PDF money-model entry in `mcp-manifest.ts`
- `experiment_metrics` table + plan-billing ledger
- 4×/day Inngest cron for solopreneur-loop, separate from existing daily business-operator
- 30-min Inngest cron for codex-maintainer
- Kill-switch wiring inside cost-guard
- `/dashboard/experiments/[slug]` page
- Slack inline approval flow for the 5 gate categories (n8n review-node pattern adapted)
- Smoke tests for tick / kill-switch / gate trigger

---

## Phase 2 — Plan (atomic tasks)

### Group A — Foundation (Parallel: yes within group)
**A1 — `experiment_metrics` migration**
- File: `supabase/migrations/03X_experiment_metrics.sql` (next free number)
- Change: New table `(business_slug, ts, kind, payload jsonb)`; RLS service-role write; indexes on `(business_slug, ts desc)` and `(business_slug, kind, ts desc)`. `kind` enum: `tick`, `cash_spend`, `revenue`, `signup`, `content_published`, `kpi_snapshot`, `plan_billing_estimate`, `kill_switch_check`, `gate_event`, `health_check`.
- Verify: `\d experiment_metrics` shows table; sample insert + select works.
- Parallel: yes

**A2 — PDF money-model entry in MCP manifest**
- File: `lib/businesses/mcp-manifest.ts`
- Change: Add or extend `digital-product` money-model resolver returning: `tavily`, `firecrawl`, `composio:stripe`, `composio:beehiiv`, `composio:gmail`, `composio:x-twitter`, `composio:linkedin`, `composio:vercel`, `composio:cloudflare`, `composio:namecheap`, `vercel-cli`, `gh-cli`. Keyword `pdf-info-products` maps here.
- Verify: `resolveManifest({niche:'pdf-info-products', moneyModel:'digital-product'})` returns expected MCPs; unit test in `__tests__/businesses/mcp-manifest.test.ts`.
- Parallel: yes

**A3 — Gate matrix + runbook**
- File: `docs/runbooks/solopreneur-experiment.md`
- Change: Document 5 gates (`niche_pick`, `domain_purchase`, `first_n_posts`, `paid_saas_signup`, `pricing_change`), Slack approval flow, kill-switch conditions, pivot logic, day 1/7/14/30 checkpoints. Cross-link from `docs/adr/INDEX.md`.
- Verify: doc renders; gate categories match B1.
- Parallel: yes

**A4 — Business row insert script**
- File: `scripts/seed-pdf-experiment.ts`
- Change: Idempotent script; insert `business` row with success-criteria fields; check existence first.
- Verify: `npx tsx scripts/seed-pdf-experiment.ts` inserts; second run is no-op; row visible in Supabase.
- Parallel: yes

### Group B — Agents (after A)
**B1 — `solopreneur-loop` agent spec**
- File: `.claude/agents/solopreneur-loop.md`
- Change: New Claude-led managed agent. Frontmatter: `name`, `description`, `tools: [Read, Edit, Grep, Glob, Bash, WebFetch, WebSearch]`. Body: (a) loop pattern (sense → decide → dispatch → evaluate → adapt), (b) gate matrix enforcement, (c) state read order (memory → Run events → Board → experiment_metrics), (d) dispatch routing (claude swarm / codex / firecrawl / tavily), (e) self-improvement via workflow-optimizer when output scores low, (f) auto-pivot trigger (7d <$5 + <50 signups → propose 3 niches via Slack).
- Verify: agent listed at session start; `dryRun: true` invocation returns structured plan, not chat.
- Parallel: B1+B2+B3 in parallel after A done

**B2 — `codex-maintainer` agent spec**
- File: `.claude/agents/codex-maintainer.md`
- Change: Variant of `codex-operator` tuned for 30-min ticks. Body: (a) container health (Coolify status, deploy logs), (b) parse Vercel build logs, (c) on-demand fresh-state research called by solopreneur-loop, (d) adversarial second-opinion grader for Claude's strategic calls (niche pick, pricing, pivot), (e) emit `health_check` rows to `experiment_metrics`.
- Verify: manual invoke runs health check <60s; logs to experiment_metrics.
- Parallel: yes

**B3 — `pdf-swarm-lead` agent spec**
- File: `.claude/agents/pdf-swarm-lead.md`
- Change: Claude Code Agent Teams lead for build steps. Spawns: `researcher` (Tavily/Firecrawl niche scan), `brand-builder` (name/voice/logo brief), `builder` (Vercel/Next.js storefront), `content-writer` (PDFs/blog/social), `marketer` (Composio social/email), `support` (Gmail triage). Each sub-agent has its own tool budget per AGENTS.md rule.
- Verify: dispatch with `swarm: true` from solopreneur-loop spawns the team; sub-agents receive task spec + tool budget.
- Parallel: yes

### Group C — Infra (C1 blocks C2/C3)
**C1 — Cost-guard kill-switch extension**
- File: `lib/cost-guard.ts`
- Change: Add `checkKillSwitch(businessSlug)` returning `{kill:boolean, reason?:string}`. Sums `experiment_metrics.cash_spend` for slug; `{kill:true}` if ≥ `business.budget_usd` OR last 7d revenue <$5 + signups <50 AND no auto-pivot remaining (timer starts at "first product live" not creation). Called inside both crons before any LLM dispatch.
- Verify: unit test — fake spend=99 → `{kill:false}`; spend=100 → `{kill:true, reason:'budget_exhausted'}`; stagnation+no-pivot → `{kill:true, reason:'stagnation_pivot_exhausted'}`.
- Parallel: no (C2/C3 import this)

**C2 — Solopreneur tick cron route**
- File: `app/api/cron/solopreneur-tick/route.ts`
- Change: Inngest function scheduled `0 9,12,15,21 * * *`. Iterates `experiment_flag=true` businesses, calls `checkKillSwitch` per slug, dispatches `solopreneur-loop` via `/api/claude-session/dispatch` (with `swarm: true` for build steps), logs `tick` row. Returns 200 + `{ok:false, errors}` on per-business failure.
- Verify: `curl -X POST /api/cron/solopreneur-tick?dryRun=true` runs one tick; `experiment_metrics` has tick row.
- Parallel: yes (after C1)

**C3 — Codex maintainer tick cron route**
- File: `app/api/cron/codex-maintainer-tick/route.ts`
- Change: Inngest function scheduled `*/30 * * * *`. Same shape as C2 but invokes `codex-maintainer` via the Codex dispatch route (verify exact entrypoint — see Risks). Always 200 even on degraded upstream.
- Verify: manual invoke runs health check; `health_check` row written; no 5xx.
- Parallel: yes (after C1)

**C4 — Provision the container**
- File: invocation only — `POST /api/businesses/pdf-experiment-01/provision`
- Change: After A4 (row exists) + B1-B3 (agents available) + C1 (kill-switch). Creates Coolify app, persists `business:pdf-experiment-01` gateway secrets, defers activation per existing runbook.
- Verify: Coolify shows new app; `connected_accounts` ready; gateway secret resolves in `resolveClawConfig()`.
- Parallel: no

### Group D — Observability (Parallel: yes)
**D1 — Plan-billing ledger logic**
- File: `lib/experiments/plan-billing-ledger.ts`
- Change: `estimatePlanBillingUsage(businessSlug, sinceTs)` sums token counts from Run events × hypothetical API price (Claude Sonnet/Opus + GPT-5.5 rates) → API-equivalent cost. Persisted as `kind=plan_billing_estimate` rows on each tick. Returns `{claudeUsd, codexUsd, totalUsd, ratioVsRevenue}`.
- Verify: ratio calculation correct on sample data; ledger row written each tick.
- Parallel: yes

**D2 — Experiment dashboard page**
- File: `app/(protected)/dashboard/experiments/[slug]/page.tsx`
- Change: Server component fetches last 30d `experiment_metrics`. Client child renders KPI cards (revenue, signups, content published, days running), plan-billing ledger ratio, run timeline, gate event log, kill-switch state badge, `[Stop experiment]` button → `POST /api/experiments/<slug>/kill`. Respects existing `(protected)` layout.
- Verify: `/dashboard/experiments/pdf-experiment-01` renders; kill button POSTs and updates state.
- Parallel: yes (after D1 ledger queryable)

**D3 — Slack inline approval gate wiring**
- File: `app/api/experiments/gate-request/route.ts` + `app/api/experiments/gate-respond/route.ts`
- Change: Adapt n8n review-node pattern. Agent POSTs `gate-request` `{slug, gate, payload}` → server posts Slack with Approve/Reject buttons → response webhook writes `gate_event` row + signals waiting tick to resume or abort.
- Verify: simulated niche-pick gate → Slack message → click Approve → tick resumes with `gate_event.outcome=approved`.
- Parallel: yes

**D4 — Vercel cron registration**
- File: `vercel.json` (or existing cron config)
- Change: Add solopreneur-tick (4×/day) and codex-maintainer-tick (every 30 min) entries with `Authorization: Bearer ${CRON_SECRET}` guard.
- Verify: `vercel.json` validates; deploy preview shows both crons listed.
- Parallel: yes

### Group E — Smoke test (Sequential)
**E1 — Single tick dry-run**
- Manual: `POST /api/cron/solopreneur-tick?dryRun=true&businessSlug=pdf-experiment-01`
- Verify: state read correctly; agent emits 3-7 sensible actions; routing chooses correct gateway per action; nothing persisted to Composio / Stripe / public accounts.

**E2 — Codex maintainer dry-run**
- Manual: `POST /api/cron/codex-maintainer-tick?dryRun=true&businessSlug=pdf-experiment-01`
- Verify: health check fires; row written; no destructive Bash actions.

**E3 — Kill-switch verification**
- Manual: insert fake `cash_spend` rows totaling $100 in `experiment_metrics`; invoke solopreneur-tick.
- Verify: cron exits early with `kill_switch_check` row; no agent dispatch.

**E4 — Gate trigger end-to-end**
- Manual: trigger niche-pick gate via dryRun agent call.
- Verify: Slack message lands with Approve/Reject; click Approve; subsequent tick reads gate as resolved and proceeds.

### Group F — Launch (Sequential, gated)
**F1 — Provide OAuth credentials**
- Manual: connect X, LinkedIn, Gmail, Stripe, Beehiiv, Vercel, Cloudflare, Namecheap via `/settings/accounts` for `pdf-experiment-01` business scope.
- Verify: `connected_accounts` rows for all 8 platforms; `executeBusinessAction({business:'pdf-experiment-01', platform:'stripe', action:'list_products'})` succeeds.

**F2 — First niche-pick gate**
- Activate cron; first tick fires niche-pick gate; user approves the niche via Slack.
- Verify: `gate_event` resolved; subsequent tick begins building (domain gate next).

**F3 — Day 1 / 7 / 14 / 30 review checkpoints**
- Manual: at each milestone, read dashboard + ledger ratio. Decide: continue, pivot (auto), or kill (manual).
- Verify: checkpoint notes appended to `## Progress` section.

---

## Phase 3 — Implement

Empty until user approves Phase 2. Per protocol, do not start implementation before approval.

---

## Progress

_To be filled in as work progresses. Use the template in CLAUDE.md (Completed / Remaining / Blockers / Open Questions)._

---

## Open questions / risks
- **Codex gateway entrypoint** — `/api/claude-session/dispatch` exists; verify Codex equivalent or whether codex-maintainer routes through same dispatch with a `model: gpt-5.5` switch. Affects C3.
- **`digital-product` money model in mcp-manifest** — may already exist; A2 may be an extend, not an add. Read file before patching.
- **Plan-billing token accounting** — do Run events log token counts today? If not, A1/D1 needs a token-emission shim before ledger can compute meaningful ratio.
- **Auto-pivot mechanics** — in-place pivot on same `business_slug` (cheaper, history mixed) or spawn `pdf-experiment-01-v2` (cleaner audit, more rows)? Recommend in-place with a `pivot_history jsonb` column on `business`.
- **Multi-tenant readiness for next month** — replicating to `-02` / `-03` is just A4 + C4 + F1 per business. Confirm crons iterate by `experiment_flag`, not hardcoded slug. (Already specified in C2/C3 — re-check during E1.)
- **Plan-amortization expectation timing** — a brand new niche won't earn for 7-14 days. Don't fire kill-switch on day 7 from creation if niche-pick gate was approved on day 5. Stagnation timer starts at "first product live", not "experiment created".
- **Sub plan choice for next month (3 businesses)** — empirical-first: stay 1× Claude Max 20x + 1× Codex Pro until rate-limits hit, upgrade the bottlenecked side only. Codex's 30-min ticks are short; Claude's parallel swarm dispatches consume more.

---

## Quick reference — file inventory
| Path | Purpose | Group |
|---|---|---|
| `supabase/migrations/03X_experiment_metrics.sql` | metrics table | A1 |
| `lib/businesses/mcp-manifest.ts` | PDF money-model MCPs | A2 |
| `docs/runbooks/solopreneur-experiment.md` | gate matrix runbook | A3 |
| `scripts/seed-pdf-experiment.ts` | business row seed | A4 |
| `.claude/agents/solopreneur-loop.md` | Claude strategist | B1 |
| `.claude/agents/codex-maintainer.md` | GPT-5.5 maintainer | B2 |
| `.claude/agents/pdf-swarm-lead.md` | Claude swarm lead | B3 |
| `lib/cost-guard.ts` | kill-switch extension | C1 |
| `app/api/cron/solopreneur-tick/route.ts` | 4×/day Claude cron | C2 |
| `app/api/cron/codex-maintainer-tick/route.ts` | 30-min Codex cron | C3 |
| `lib/experiments/plan-billing-ledger.ts` | ledger logic | D1 |
| `app/(protected)/dashboard/experiments/[slug]/page.tsx` | dashboard | D2 |
| `app/api/experiments/gate-{request,respond}/route.ts` | Slack gate flow | D3 |
| `vercel.json` | cron registration | D4 |
