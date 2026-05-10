# Runbook — Autonomous Solopreneur Experiment (PDF Business)

## Overview

`pdf-experiment-01` is the first **fully autonomous Claude-led solopreneur loop** — one PDF info-product business operated by the `solopreneur-loop` agent (Claude, 4×/day cron) and the `codex-maintainer` agent (GPT-5.5, 30-min cron) inside its own per-business Coolify container on KVM4. The experiment is hard-capped at **$100 cumulative cash spend** (Composio-brokered, no raw API keys) with a **30-day MRR target of $50** as the proof-of-life signal. The longer-term goal is to push the steady-state MRR to **$400/mo** so a single business amortizes the Claude Max 20x + Codex Pro subscriptions without API metering. Strategic gates (5 categories) require operator approval via Slack inline buttons; everything else runs autonomously. If the loop works, the same agent specs replicate to 3 parallel businesses next month with no per-business code changes.

## Gate matrix

The agent must request human approval **only for these five categories**. Everything else executes without a gate.

| Gate | When fired | Reason |
|---|---|---|
| `niche_pick` | Once, on first tick after provision | Biggest single irreversible call — informs every downstream asset, content angle, and pricing assumption |
| `domain_purchase` | Any spend ≥ $1 on a domain | Real cash leaves the budget; refunds are partial and slow; domain choice is hard to undo without rebrand |
| `first_n_posts` | First 3 posts per platform (X, LinkedIn, etc.) | Voice / brand calibration; gate auto-disables for that platform after 3 approvals |
| `paid_saas_signup` | Any new recurring billing line | Recurring cost compounds against the $100 cap; one missed cancellation can wipe the budget |
| `pricing_change` | Any change ≥ ±$10 from current price | Conversion-rate impact is non-trivial and the agent's pricing intuition is unproven |

Gates fire by writing a `gate_event` row (status `pending`) to `experiment_metrics` and then calling `POST /api/experiments/gate-request` (D3 in the task plan). The current tick **pauses** at the gate and resumes on the next scheduled tick — the agent does not poll. If the gate is still `pending` on the next tick, the agent skips that branch and works on non-gated tasks.

The `first_n_posts` gate is per-platform and self-disabling: after three approved posts on a given platform, the gate is auto-set to `inactive` for that platform and posting becomes autonomous.

## Slack approval flow

Round-trip:

1. Agent decides it needs approval → POSTs `/api/experiments/gate-request` with `{ slug, gate, payload }`. Payload is the gate-specific context (proposed niche + rationale, domain + price + registrar, draft post text, SaaS plan + monthly cost, old → new price).
2. Server inserts a `gate_event` row (`status=pending`) and posts a Slack message via the existing review-node Slack integration. The message includes the payload preview and **Approve** / **Reject** inline buttons.
3. Operator clicks Approve or Reject on Slack.
4. Slack hits `/api/experiments/gate-respond` with the action; server updates `gate_event.outcome` (`approved` / `rejected` / `expired`) and stamps `decided_at`.
5. The next scheduled tick reads the resolved `gate_event` and proceeds (on approval) or records the rejection rationale and replans (on rejection).

Gates with no decision after 24 h auto-expire to `rejected` so a stalled gate doesn't block the loop forever. The agent treats `expired` identically to `rejected`.

## Kill-switch conditions

The kill-switch fires inside `lib/cost-guard.ts` `checkKillSwitch(businessSlug)` (C1 in the task plan). Both crons call this **before any LLM dispatch on every tick**. When `{kill: true}` is returned, the cron writes a `kill_switch_check` row, exits the tick early, and emits a Slack notification. No agent dispatch happens.

Two trigger conditions:

| Trigger | Condition | `reason` |
|---|---|---|
| Budget exhaustion | Sum of `experiment_metrics.cash_spend` for the slug ≥ `business.budget_usd` (default $100) | `budget_exhausted` |
| Stagnation (no auto-pivot remaining) | Last **7 consecutive days** with `revenue_usd < $5` AND `signups < 50` AND `pivot_history` already records one auto-pivot | `stagnation_pivot_exhausted` |

**Stagnation timer caveat:** the 7-day window starts at the timestamp of the **first product live** event (`experiment_metrics.kind = content_published` with `payload.is_product = true`), **not** at experiment-creation time. A new niche typically takes 7–14 days to ship its first paid PDF, so anchoring the timer to creation would fire the kill-switch before the agent has a chance to earn anything. If no product is live yet, the stagnation trigger is dormant.

The kill-switch is **inside the loop**, not a passive monitor. Once it fires, the cron route remains 200 (so Vercel doesn't retry), but every subsequent tick exits at the same check until the operator either raises `business.budget_usd`, manually clears the stagnation flag, or explicitly stops the experiment via `POST /api/experiments/<slug>/kill`.

## Pivot logic

**One auto-pivot is allowed within the $100 budget.** If the stagnation window (7d <$5 revenue + <50 signups) hits and `pivot_history` is empty:

1. The agent enters pivot-proposal mode — cancels in-flight build steps, summarizes what didn't work, runs a fresh niche-research dispatch, and proposes **3 alternative niches** with rationale.
2. Proposal goes out as a `niche_pick` gate via Slack with the three options as inline buttons (plus a fourth Reject-all button).
3. Operator picks one niche → the agent appends a `pivot_history` row to the `business` table (`{ from_niche, to_niche, decided_at, reason }`) and resets the stagnation timer to "first product live on the new niche".
4. Existing assets that map cleanly to the new niche stay; the rest are archived. The $100 budget keeps counting from where it was — the pivot doesn't refund spent cash.

After the auto-pivot is consumed, the second stagnation triggers a **hard kill** (`stagnation_pivot_exhausted`) — no second pivot is offered. The operator can manually intervene by editing `pivot_history` to remove the row, but the default path is to accept the kill and decide whether to spawn a fresh experiment under a new slug.

## Review checkpoints

Open `/dashboard/experiments/pdf-experiment-01` (D2) at each milestone. The page shows live KPIs, the plan-billing ledger, the gate event log, the kill-switch state, and the run timeline.

| Day | What to look at | Decision |
|---|---|---|
| 1 | Niche-pick gate resolved, domain purchased, first storefront commit landed in Vercel, `experiment_metrics` populating tick rows | Continue / pause if container is unhealthy |
| 7 | Content cadence (≥ 3 posts/platform), first-product-live event timestamp, signups trending, plan-billing ledger ratio (Claude+Codex API-equivalent USD vs revenue USD) | Continue / pause if no product live yet — investigate why |
| 14 | Revenue trend, list size growth, gate event log (approve/reject ratio — too many rejects = misaligned agent), open `pricing_change` or `paid_saas_signup` proposals | Continue / pivot (auto, if stagnant) / kill (manual) |
| 30 | 30-day MRR vs $50 target, list size vs 100 target, plan-billing ratio (is the loop amortizing the subscriptions yet?), cumulative cash spend vs $100 cap | Continue (graduate to multi-tenant rollout) / pivot / kill |

At each checkpoint, append a dated entry to the `## Progress` section of `task_plan-solopreneur-experiment.md` with the decision and rationale. If the decision is **continue**, no further action — the cron keeps ticking. If **pivot**, trigger the pivot flow above. If **kill**, click `[Stop experiment]` on the dashboard (or `POST /api/experiments/<slug>/kill`) and write a post-mortem atom to memory-hq under `mocs/solopreneur-experiments`.

## Slack app setup (one-time, before launch)

The 5 strategic gates (`niche_pick`, `domain_purchase`, `first_n_posts`, `paid_saas_signup`, `pricing_change`) round-trip through Slack. The agent posts an approval request via `/api/experiments/gate-request` (D3); your click on Approve/Reject hits `/api/experiments/gate-respond` (D3); the gate row resolves and the next tick proceeds.

**One-time Slack-app config** — do this *once*, applies to every business that runs the experiment.

1. **Create the Slack app** — https://api.slack.com/apps → **Create New App** → **From scratch** → name "Nexus Experiments", workspace = yours.
2. **Incoming Webhooks** (left sidebar) → toggle **On** → **Add New Webhook to Workspace** → pick the channel where gate notifications land (recommend a dedicated `#nexus-experiments` channel) → **Allow** → copy the `https://hooks.slack.com/services/T.../B.../...` URL.
3. **Interactivity & Shortcuts** → toggle **On** → **Request URL** = `${NEXUS_BASE_URL}/api/experiments/gate-respond` (the deployed Nexus URL — Slack must reach it over the public internet) → **Save Changes**.
4. **Basic Information** (left sidebar) → scroll to **App Credentials** → copy the **Signing Secret**.
5. **Doppler** — paste both values:
   - `NEXUS_SLACK_WEBHOOK_URL = https://hooks.slack.com/services/...`
   - `NEXUS_SLACK_SIGNING_SECRET = <signing secret>`
   - Optional: `SLACK_EXPERIMENT_CHANNEL_ID = C0123456789` (informational only — the webhook URL pins the channel, this var is just shown in API responses)
6. **Sync to Vercel + redeploy** — `doppler run -- bash scripts/sync-vercel-env.sh && npm run deploy -- --vercel`.

**Verify with one command** — after deploy:
```bash
doppler run -- npx --yes tsx scripts/smoke-experiment.ts --phase=preflight
```
The `preflight` phase POSTs a test message to your webhook and confirms the row + env vars are populated. If the message arrives in your channel, the outbound side works. The inbound side (signing) is exercised by `--phase=e4` end-to-end after a real gate fires.

**Two ways to verify Slack is reachable from this Claude Code session**:
- *(simplest, no setup)* Run `scripts/smoke-experiment.ts --phase=preflight` — it posts via the existing `lib/slack/client.ts` helper and reports PASS/FAIL.
- *(persistent integration)* Add Anthropic's reference Slack MCP to `~/.claude/settings.json` if you want Claude Code (not just the experiment) to read/write Slack from any session. The Composio Rube MCP that ships with the per-business container already exposes Slack via Composio brokerage — the experiment uses it without you adding anything else.

## Smoke verification (Group E)

Before activating the cron and handing the experiment to its agents, run the smoke runner:

```bash
# Full suite (preflight → E1 → E2 → E3 → E4)
doppler run -- npx --yes tsx scripts/smoke-experiment.ts

# One phase at a time
doppler run -- npx --yes tsx scripts/smoke-experiment.ts --phase=e1     # solopreneur-tick dry-run
doppler run -- npx --yes tsx scripts/smoke-experiment.ts --phase=e2     # codex-maintainer-tick dry-run
doppler run -- npx --yes tsx scripts/smoke-experiment.ts --phase=e3     # kill-switch verification
doppler run -- npx --yes tsx scripts/smoke-experiment.ts --phase=e4     # gate-request → Slack click

# Cleanup smoke fixtures
doppler run -- npx --yes tsx scripts/smoke-experiment.ts --teardown
```

Phases must all PASS before activating the cron in Vercel for the first business. E4 requires a human Slack click — the script triggers and prints what to look for; you click *Reject* on the test message (it's a fixture).

## Cross-links

- Task plan and atomic tasks: [`task_plan-solopreneur-experiment.md`](../../task_plan-solopreneur-experiment.md)
- Per-business container provisioning: [`docs/runbooks/per-business-container-rollout.md`](./per-business-container-rollout.md)
- Codex auth rotation (~30-day refresh-token cadence): [`docs/runbooks/codex-gateway-auth-rotation.md`](./codex-gateway-auth-rotation.md)
