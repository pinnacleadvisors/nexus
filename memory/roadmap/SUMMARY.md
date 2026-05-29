# Nexus — Roadmap Summary

> Last updated: 2026-05-28. Source of truth: `ROADMAP.md` + `task_plan.md` + `task_plan-platform-improvements.md`.
> Legend: ✅ Complete · 🔧 Partial · ⬜ Not started
>
> **Recent shipped work (2026-05-27/28)** is captured in the dedicated
> [UX Consultation R-stream](#ux-consultation-2026-05-27--brain-dump-r-stream)
> section near the bottom — the Phase/Pillar table above predates it.

| Phase | Title | Status | Notes |
|-------|-------|--------|-------|
| 1 | Foundation | ✅ | Next.js 16, Clerk, Doppler, Vercel, sidebar, dark theme |
| 2 | Idea Forge | 🔧 | Chat ✅; Gantt ✅; save/resume + multi-business → Supabase pending |
| 3 | Dashboard | 🔧 | UI ✅; Supabase data + Stripe revenue + Sentry pending |
| 4 | Kanban Board | 🔧 | Board + drag-drop ✅; diff viewer ✅ (A12); orphan-card sweep + lineage FKs ✅ (migration 025, 2026-05-03) |
| 5 | OpenClaw Integration | ✅ | API + proxy ✅; encrypted `user_secrets` DB-backed config ✅ (B10) |
| 6 | Knowledge Base / Notes | ✅ | Notion + Obsidian integration complete |
| 7 | Backend & Data Layer | ✅ | Supabase, R2, Inngest wired |
| 8 | Token Efficiency | ✅ | Sliding window, dual-model, prompt caching (C3), cost alerts + hard cap (B9) |
| 9 | Security Hardening | ✅ | MFA, encryption (fail-closed B6), rate limiting, CSRF, audit log, CSP dev-gated (B7), r2-url-guard (B3), storage user-id prefix (B4), auth on chat/content/r2/storage/audit (B1–B5), proxy.ts matcher widened to all `(protected)/` routes (2026-05-03) |
| 10 | Agent Capabilities | ✅ | 10 specialist agents at `/tools/agents` |
| 11 | Multi-Agent Orchestration | ✅ | Swarm kernel, Queen, Consensus, Router (decay C6), ReasoningBank (A8 feedforward), WASM, MCP, GraphRetriever (A7) |
| 12 | Tribe v2 Content Engine | 🔧 | Core ✅; content analytics + muapi.ai media pairing ⬜ |
| 13 | Consultant Agent + n8n | ✅ | 13a consultant ✅, 13b n8n generation ✅, 13c OpenClaw bridge ✅ |
| 14 | 3D Knowledge Graph | 🔧 | Full 3D graph ✅; Forge/Dashboard minimap embed ⬜ |
| 15 | Library Layer | ✅ | Code/agent/prompt/skill library; auto-promote on successful run (C4) |
| 16 | Org Chart & Agent Hierarchy | 🔧 | Org chart ✅; Realtime (vs polling) + Phase 16b items ⬜ |
| 17 | DeerFlow 2.0 | 🔧 | 17a deploy ⬜, 17b integration ⬜; 17c Tavily live search ✅ |
| 18 | Video Generation Pipeline | 🔧 | 18a partial ✅ (Kling/Runway/route); 18b–18d ⬜ |
| 19 | Nexus Builds Nexus | 🔧 | 19a dev console ✅, 19b research loop ✅; diff viewer ✅ (A12); CI badge + error-paste mode ⬜ |
| 20 | Local-First Memory Engine | 🔧 | GitHub memory API ✅; Notion sync optional ⬜ |
| 21 | OSS-First Stack | ⬜ | Brevo, Umami, GlitchTip, Coolify, Coqui TTS, SadTalker |
| 22 | Leiden Algorithm Migration | ⬜ | Replace Louvain in `lib/graph/builder.ts` with pure TS Leiden |
| 23 | Learning System | 🔧 | Duolingo path + FSRS-4 + 4 card kinds + Feynman grader; manual sync button on `/learn` ✅ (2026-05-03); cron at `0 5 * * *` UTC; migration 023 + manual `OWNER_USER_ID` setup pending |
| **A** | **Autonomous Business Operator** | **🔧** | `business_operators` table (migration 024) + Inngest daily cron + Slack approve/reject. Webhook health check, slack URL encryption, board "connected" card on URL save: 2026-05-03 |
| **SOE** | **Self-Optimising Ecosystem** | **🔧** | See below — Pillars A/B/C from `task_plan.md` |
| **PI** | **Platform Improvements** | **🔧** | `task_plan-platform-improvements.md` — onboarding doc, orphan sweep, webhook verify, /learn sync button, /manage-platform health panel, security pass |
| **MCK** | **Mission Control Kit imports** | **✅** | Six features ported from the ClaudeClaw V3 kit: exfil guard at every outbound path, hot-reloadable kill switches (6, ~60s cache), Slack war-room slash commands (`/standup`, `/discuss`, `/ask`), molecular memory hybrid scoring (RRF over FTS5+pgvector+salience) + ADD-only atoms, agent-overload analyzer, 90-day audit-log retention with pinning. See migrations 028–030; Switches/Audit tabs on `/manage-platform`. |

## Self-Optimising Ecosystem (SOE) — cross-cutting phase

Plan in `task_plan.md`. Three pillars, each independently valuable:

### Pillar A — Close the idea → exec → optimise loop

| ID | Title | Status | Key paths |
|----|-------|--------|-----------|
| A1 | `runs` state machine migration | ✅ | `supabase/migrations/015_runs.sql` |
| A2 | Run / RunEvent / RunPhase types | ✅ | `lib/types.ts` |
| A3 | Run controller library | ✅ | `lib/runs/controller.ts` |
| A4 | `/api/runs` routes | ✅ | `app/api/runs/route.ts` + `[id]/` |
| A5 | Forge "Build this" → run creation | ✅ | `components/forge/ForgeActionBar.tsx` + `components/forge/ForgeSession.tsx` → `POST /api/runs` → `/board?runId=...`; board renders active-run banner from `/api/runs/[id]` |
| A6 | Run-aware session dispatch | ✅ | `app/api/claude-session/dispatch/route.ts` (runId + appendEvent + advancePhase) |
| A7 | Graph-keyed context retrieval | ✅ | `lib/swarm/GraphRetriever.ts` + `lib/swarm/TokenOptimiser.ts` |
| A8 | ReasoningBank feedforward | ✅ | `lib/swarm/Queen.ts` (strategicDecompose) + migration 016 `plan_patterns` |
| A9 | Metric-triggered optimiser | ✅ | `lib/runs/metric-triggers.ts` + `app/api/cron/metric-optimiser/` |
| A10 | Publish/distribute step | ✅ | `lib/publish/{youtube,tiktok,instagram,metrics}.ts` + `app/api/publish/` |
| A11 | Measure phase ingestion | ✅ | `lib/runs/measure-ingester.ts` + `app/api/cron/ingest-metrics/` |
| A12 | Self-build diff viewer | ✅ | `components/board/DiffViewer.tsx` + `app/api/build/diff/route.ts` |

### Pillar B — Security hardening

| ID | Title | Status | Key paths |
|----|-------|--------|-----------|
| B1 | Auth-gate `/api/chat` | ✅ | `app/api/chat/route.ts` |
| B2 | Auth-gate content routes | ✅ | `app/api/content/{generate,score,variants}/route.ts` |
| B3 | Auth-gate `/api/r2` + egress allow-list | ✅ | `lib/r2-url-guard.ts` + `app/api/r2/route.ts` |
| B4 | Auth-gate `/api/storage` + user-id prefix | ✅ | `app/api/storage/route.ts` |
| B5 | Auth-gate `/api/audit` | ✅ | `app/api/audit/route.ts` |
| B6 | Encryption key fail-closed | ✅ | `lib/crypto.ts` — throws in production when `ENCRYPTION_KEY` unset |
| B7 | CSP hardening | ✅ | `next.config.ts` — `unsafe-eval` only in dev |
| B8 | `withGuards(handler, {rateLimit, csrf, costCap})` wrapper | ⬜ | routes still wire guards directly |
| B9 | Per-user daily cost cap | ✅ | `lib/cost-guard.ts` (402 on `USER_DAILY_USD_LIMIT`) |
| B10 | OpenClaw config → encrypted DB column | ✅ | `supabase/migrations/014_user_secrets.sql` + `app/api/claw/config/route.ts` |
| B11 | Secret-scanning pre-commit hook | 🔧 | `scripts/scan-secrets.sh` exists; `.husky/pre-commit` ⬜ |
| B12 | Rate-limit audit of public surfaces | ⬜ | Per-route bucket review pending |

### Pillar C — Self-optimising performance

| ID | Title | Status | Key paths |
|----|-------|--------|-----------|
| C1 | Per-run + per-agent observability | ✅ | `lib/observability.ts` + migration 017 `metric_samples` |
| C2 | Regression detector | ✅ | `lib/observability/regression.ts` + `app/api/cron/regression-sweep/` |
| C3 | Prompt-cache hit rate optimiser | ✅ | `lib/swarm/TokenOptimiser.ts` + `lib/swarm/Queen.ts` |
| C4 | Library promotion on success | ✅ | `lib/library/promoter.ts` + `POST /api/library { promoteRunId }` |
| C5 | Experiment harness (A/B) | ✅ | migration 018 + `lib/experiments/` + `/api/experiments` + `ExperimentPanel.tsx` |
| C6 | Adaptive routing with decay | ✅ | `lib/swarm/Router.ts` — 14-day exponential decay + `feedRouterFromMetricSamples` |
| C7 | Graph-aware chat cache | ✅ | `/api/chat` graph-atom short-circuit with `<graph-cache>` marker |
| C8 | Nightly graph rebuild | ✅ | `app/api/cron/rebuild-graph/route.ts` |

## UX Consultation 2026-05-27 + brain-dump (R-stream)

Operator-driven UX consultation (`docs/research/UX_CONSULTATION_2026-05-27.md`)
+ a brain-dump of approved follow-ups. Shipped over 2026-05-27/28 as a
burst of small, independently-reviewable PRs (#411–#427). All ✅ unless noted.

| ID | Title | Status | Key paths |
|----|-------|--------|-----------|
| R1 | `/inbox` activity stream — time-buckets + per-business filter + since-last-visit | ✅ | `app/(protected)/inbox/` |
| R2 | `/approvals` bulk approve — checkbox + group select + batch endpoint | ✅ | `app/api/approvals/decide-batch/route.ts` |
| R3 | Per-business daily cost cap + visualizer | ✅ | migration 089 + `lib/cost-guard.ts` |
| R4 | Operator notifications — Slack DM + web push + settings UI | ✅ | `lib/notifications/{dispatch,slack,webpush,operators}.ts`, migration 091, `components/settings/NotificationsPanel.tsx` |
| R4-wiring | notifyOperator wired into 3 triggers: approval-insert / graduation / kill-switch | ✅ | `lib/approvals/insert.ts`, `app/api/businesses/[slug]/graduate/route.ts`, `app/api/cron/solopreneur-tick/route.ts` (false→true transition guard) |
| R5 | `/dashboard` coaching tab — actionable insights | ✅ | `components/dashboard/CoachingCard.tsx` + `app/api/dashboard/coaching/` |
| R6 | Weekly digest — Sunday email + fleet totals + wins/risks + memory atom | ✅ | `lib/digest/build-weekly.ts` + `app/api/cron/weekly-digest/` (cron `0 1 * * 0`) |
| R7 | Fleet actions — bulk Pause / Resume / Smoke / Refresh-KPIs | ✅ | `app/api/businesses/bulk/route.ts` + `components/businesses/FleetActionsBar.tsx` |
| R8 | Day-1 welcome tour modal (0-business operators) | ✅ | `components/dashboard/WelcomeTourModal.tsx` |
| R9 | Chat-session retrospectives — daily cron summary + banner on reopen | ✅ | migration 092 + `app/api/cron/chat-retrospectives/` + `components/chat/RetrospectiveBanner.tsx` |
| R10 | KPI freshness indicator — "Updated Nm ago" + amber when >24h stale | ✅ | `components/dashboard/KpiGrid.tsx` + `app/api/dashboard/route.ts` |
| R11 | Fixture-mode top-bar badge + scripted walkthrough | ✅ | fixture badge in topbar |
| R12 | Mobile-first sticky operator action bar | ✅ | `/businesses/[slug]` sticky bottom bar |
| R13 | Bloomberg-terminal `/audit` — multi-pane dense activity terminal | 🟡 | Groups A (scaffold) + B (live streams) PRs open. A: `lib/audit/{types,format,sources}.ts` (9-source registry), owner-gated service-role Server Action, `components/audit/{AuditTerminal,AuditStreamTable}.tsx` (localStorage tabs, mobile `<select>`, per-pane filters + freeze). B: migration 093 adds `audit_log`/`approvals`/`tool_call_audit` to `supabase_realtime`; `lib/audit/streams.ts` (browser anon `postgres_changes`); heartbeats via `usePollWithBackoff`. C: `lib/audit/layout.ts` (base64url encode/decode) + `?layout=` hydrate/share in `AuditTerminal` (Share button writes the permalink + copies it; shared link reconstructs the exact pane set, overriding localStorage). All 3 PRs open. Verified: Realtime WS connects, Heartbeats polls 4 providers, layout round-trips (4-pane share → reload reconstructs), 0 console errors on /audit. `task_plan-bloomberg-audit.md` |
| Cache | Smart-caching layer — `agent_response_cache` + `cacheWrap` + eviction cron | ✅ | migration 090 + `lib/agents/cache.ts` + `app/api/cron/agent-cache-evict/` (cron `30 6 * * *`). Wired into `/api/connected-accounts/describe` (24h) + `lib/models/recommender.ts` (24h). |
| Loops | Operator-configurable iteration framework ("Loops") — declare North Star + end-outcome + delegated agent + caps/gates; platform runs the loop within bounds via `loop-runner` on the existing claude-gateway. v2 adds `mode=synthesize` (crystallize a reusable sub-harness for a novel goal, two-tier explorer→verifier). | 🟡 | Group A (schema): migrations 094 `loops` / 095 `loop_iterations` / 096 `gateway_turns.loop_id` (v2 cols folded into 094 w/ `iterate` defaults) + `lib/loops/types.ts`. B (API), C (UI), D (loop-runner spec), E1–E4 (sub-harness synthesis) PRs follow. `task_plan-loops-sprints.md` |
| NIM | NVIDIA NIM LLM provider adapter (free-tier hosted inference) | ✅ | `lib/llm/provider.ts` |
| Dark | Dark-mode lock (no toggle) | ✅ | `app/globals.css` |

**Still queued from brain-dump (scoped, not yet built):**
- Bloomberg-terminal `/audit` redesign — `task_plan-bloomberg-audit.md` — 🟡 all 3 PRs (A scaffold, B streams, C layouts) open, see R13 above
- Loops/Sprints operator-configurable iteration primitive — `task_plan-loops-sprints.md` (5 PRs)
- Plugins viewable+configurable in settings
- Deferred: AI council skill, custom dashboard widgets / space-agent fork, voice control, Linear absorption
