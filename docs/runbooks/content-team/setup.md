# Content team — setup runbook

> Goal: spin up the content-team agent roster for a business and produce
> the first short-form video clip end-to-end.

This runbook assumes the operator has read `task_plan-content-team-higgsfield.md`
and `task_plan-departments-and-ecosystems.md` (the ecosystem-adapter spine).

## Prerequisites

| Requirement | Where it lives | Status |
|---|---|---|
| 7 content-team agent specs | `.claude/agents/departments/content/*.md` | ✅ shipped |
| Higgsfield ecosystem adapter | `lib/ecosystems/adapters/higgsfield.ts` | ✅ shipped |
| `creator` niche MCP profile | `lib/businesses/mcp-manifest.ts` (`niche: 'creator'`, `mcps: ['higgsfield', 'kling', 'elevenlabs', 'heygen']`) | ✅ shipped |
| Doppler secrets | `HIGGSFIELD_API_KEY`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`, `RUNWAY_API_KEY`, `MUAPI_AI_KEY` | Operator-installed; check via `doppler secrets --config prd` |
| Optional self-hosted endpoint | `HIGGSFIELD_BASE_URL` in Doppler | Set only when running Higgsfield on KVM4 GPU |

If any row above is missing, fix it before proceeding.

## Provisioning the team for a business

Two paths — pick one based on whether the business already exists.

### Path A — brand-new business with `niche=creator`

1. Open `/businesses/new` and walk the wizard. Set `niche: creator` (or
   one of the matchers: `influencer`, `youtuber`, `streamer`). The wizard
   auto-picks the right MCP set for the per-business container.
2. Land on `/businesses/<slug>`. The header shows a SIM badge and the
   `NextStepsCard` lists the 5 onboarding steps.
3. (Optional) open the chat at `/businesses/<slug>/chat` and type
   `spawn the content team`. The business-copilot routes through
   `materialiseTeam('content')` (see `lib/teams/template.ts`).

### Path B — existing business switching to content workflow

1. Edit the business's row at `/settings/businesses`. Change `niche` to
   `creator`. The MCP manifest re-resolves on next container restart.
2. Visit `/teams`. Click the "Spawn department" picker on the business's
   row and pick **Content**. The 7 agents materialise as `team_members`
   rows pointing at the 7 content-team specs.
3. The /teams page now shows the team active. Each agent's binding (which
   `video` adapter, which `voice` adapter, etc.) is editable inline.

## Producing the first clip

1. In the business chat, type something like:
   `make one 15-second YouTube Short about <topic>`
2. The business-copilot routes to `content-lead`, which:
   - dispatches `content-trend-scout` if there are no trend atoms newer
     than 7 days for this niche
   - emits an `approval-request` with `gate: content_concept` listing
     3 concept cards
3. Operator approves one concept. The chain runs:
   `content-script-writer` → `content-asset-builder` → `content-edit-publisher`
   (with `swarm: true` set on the dispatch — see `/api/claude-session/dispatch`).
4. Before publish, the edit-publisher emits another `approval-request`
   with `gate: content_publish` showing the final cut. Operator approves.
5. 24h after publish, `content-perf-analyst` reads analytics via Composio
   and writes one `kind: kpi_observation` atom per platform. The next
   concept-writer cycle reads those atoms.

## Cost & budget controls

`checkKillSwitch(businessSlug)` runs before every paid step. Per-business
cost ceilings live in `business_operators.kpi_targets` —
`content_render_cents_per_day` is the relevant one. The Higgsfield adapter
reports its rendered seconds back so the cost-guard's per-step accumulator
sees the actual API charge.

Open-mode Higgsfield (`HIGGSFIELD_BASE_URL` pointing at the self-hosted
KVM4 container) drops per-clip cost from $0.50–$2 to ~$0.05. Recommended
once the cadence is ≥3 videos/week per business.

## What to check when something goes wrong

| Symptom | First place to look |
|---|---|
| "No fixture for higgsfield" error during dev | Fixture mode is ON; flip OFF at `/settings → Access` or add a fixture for the verb in `lib/fixtures/actions.ts` |
| Higgsfield adapter returns `rate_limited` | Self-hosted endpoint isn't set; hit the hosted API's quota. Set `HIGGSFIELD_BASE_URL` |
| Asset-builder hangs >60s | Adapter's hard timeout fired. Check `experiment_metrics` for the failed render row + the upstream's error message |
| Operator approved the concept but the script never appears | Run-events table has the dispatch attempt. Inspect via `/audit?agent=content-script-writer` |
| Performance analytics never come back | 24h scheduled task isn't firing. Check `cron-job.org` for `Nexus: content-perf-tick` (or whatever the cron entry name is) |

## Related docs

- [task_plan-content-team-higgsfield.md](../../task_plan-content-team-higgsfield.md) — the plan + cost model
- [task_plan-departments-and-ecosystems.md](../../task_plan-departments-and-ecosystems.md) — the adapter spine this team uses
- [docs/runbooks/per-business-container-rollout.md](../per-business-container-rollout.md) — per-business container provisioning
- [docs/runbooks/dev-fixture-harness.md](../dev-fixture-harness.md) — using fixtures while developing the team
