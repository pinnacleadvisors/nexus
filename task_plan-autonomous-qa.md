# Autonomous QA Loop — Integration Plan

Goal: When Nexus deploys, a headless agent on the Coolify host runs Playwright smoke specs against the live Vercel URL, fetches relevant Vercel logs + Sentry events on failure, dispatches a fix-attempt to the self-hosted Claude Code gateway (Max-plan-billed), and opens a PR via the existing `/api/build/diff` machinery. Human gate on the Board stays authoritative — no auto-merge.

Success criteria:
- A clean deploy = 0 plan-tokens consumed (Playwright passes, no dispatch).
- A failing deploy = 1 fix-attempt dispatch through the gateway, with screenshot + 30 s of Vercel logs + Sentry events embedded in the brief.
- `ANTHROPIC_API_KEY` can be unset in production and Nexus still works (Max-plan-only proven).
- The qa-runner authenticates as a dedicated Clerk bot user via short-lived sign-in tickets — no bypass of `proxy.ts`, no shared human session.
- Every Vercel function log lands in Supabase `log_events` (hot fields) + R2 (raw JSONL), searchable by `request_id`/`route`/`since`.
- `npx tsc --noEmit` passes.

Hard constraints:
- Stack rules in `AGENTS.md` / `memory/platform/STACK.md` (Next.js 16 App Router, `proxy.ts` not `middleware.ts`, `'use client'` boundary, all shared types in `lib/types.ts`, no `tailwind.config.js`).
- No secrets committed; every new env var added to `memory/platform/SECRETS.md`.
- Every new mutation endpoint: `auth()` OR bot-token guard → `ratelimit()` → CSRF/HMAC check → `audit.log()` write.
- **No auto-merge to main.** qa-runner opens PRs / Board cards; humans merge.
- Bot user is in `ALLOWED_USER_IDS`. If bearer leaks the blast radius is one bot Clerk user, not the owner.
- Headless-only: no GUI dependencies, no `xvfb`. Use the official `mcr.microsoft.com/playwright` Docker base.
- Write-size discipline: every code task fits one tool call under 300 lines / 10 KB.

---

## Phase 1 — Explore (findings)

### What already exists (don't rebuild)
- **Self-hosted gateway**: `services/claude-gateway/` — HMAC + bearer protocol, `/messages`, `/api/jobs` async, `/api/sessions/:id/stream` SSE. Single-worker FIFO.
- **AI SDK chokepoint**: `lib/claw/llm.ts::callClaude` already routes Gateway → API. Most call sites already migrated.
- **Self-build pipeline**: `/api/build/{diff,dispatch,plan,research}` ready. `workflow-optimizer` agent + `workflow_feedback` table for human review.
- **Run state machine**: `runs` + `run_events` tables, `lib/runs/controller.ts`. Pillars A1–A12 done.
- **Cron infra**: Inngest + Vercel cron + `app/api/cron/*`. `research-loop.ts` runs `npm audit` weekly.
- **Auth allowlist**: `proxy.ts` reads `ALLOWED_USER_IDS`; cookie-based Clerk sessions.
- **Sentry**: server config wired (`sentry.server.config.ts`).

### What's missing
1. **No browser-level test signal.** Zero Playwright/Puppeteer in repo. Type-check passes ≠ UI works.
2. **No Vercel log access.** Agents see browser-side errors only; server-side logs not indexed.
3. **Direct `@ai-sdk/anthropic` call sites** that bypass `callClaude` (research-loop.ts, possibly more) — block the Max-only goal.
4. **No bot identity for Clerk** — qa-runner can't sign in.
5. **No qa-runner service** on the Coolify host.

---

## Phase 2 — Plan

Tasks sized to fit one tool call under the 300-line cap. Atomic and parallelisable.

### Pillar 1 — Max-plan-only routing

#### Q1 — `CLAUDE_MAX_ONLY` guard
- File: `lib/claw/llm.ts`
- Change: When `CLAUDE_MAX_ONLY=1` is set, the API fallback path throws instead of silently using `ANTHROPIC_API_KEY`. Surfaces accidental API leaks loudly.
- Verify: Set the env var, run a route that bypasses gateway → expect a clear error, not a silent API call.
- Parallel: yes.

#### Q2 — Migrate `inngest/functions/research-loop.ts`
- File: `inngest/functions/research-loop.ts`
- Change: Replace `generateText({ model: anthropic(...) })` with `callClaudeText({ system, prompt, sessionTag: 'research-loop' })`. Pass the `qa-bot` userId so the gateway allowlist accepts it.
- Verify: Trigger the cron manually; gateway log shows the dispatch; no `ANTHROPIC_API_KEY` usage.
- Parallel: yes.

#### Q3 — Audit remaining call sites
- Files: All matches of `from '@ai-sdk/anthropic'` from earlier grep — `lib/swarm/Consensus.ts`, `lib/swarm/Queen.ts`, `lib/library/seed.ts`, `app/api/agent/route.ts`, etc.
- Change: Confirm each either uses `tryGateway` first or has a documented reason to bypass (e.g. structured-output schemas the CLI doesn't yet support). Flag for follow-up if not.
- Verify: Static audit + a doc comment per intentional exception.
- Parallel: yes (read-only audit).

### Pillar 2 — Bot identity

#### Q4 — Bot bearer-token auth helper
- File: `lib/auth/bot.ts` (new)
- Change: Export `authBotToken(req): string | null`. Reads `Authorization: Bearer <BOT_API_TOKEN>`; if matches `process.env.BOT_API_TOKEN`, returns the bot's Clerk user_id from `BOT_CLERK_USER_ID`. Otherwise null.
- Verify: Call with valid + invalid tokens; correct user_id or null.
- Parallel: yes.

#### Q5 — Clerk sign-in ticket issuer
- File: `app/api/admin/issue-bot-session/route.ts` (new)
- Change: HMAC-verified POST (same shape as `services/claude-gateway`). Body `{ userId }`. Calls `clerkClient.signInTokens.createSignInToken({ userId, expiresInSeconds: 3600 })`. Returns `{ ticket, url }`. Rate-limited to 6/min.
- Verify: Hit with HMAC-signed body, get a working Clerk URL; bot redeems → real session.
- Parallel: no (depends on Q4 for the userId source).

### Pillar 3 — Vercel log drain

#### Q6 — Migration `022_log_events.sql`
- File: `supabase/migrations/022_log_events.sql` (new)
- Change: `log_events` table — `id uuid pk, deployment_id text, request_id text, route text, level text, status int, duration_ms int, message text, raw_url text, created_at timestamptz`. Indexes on `(request_id)`, `(created_at desc)`, `(route, created_at desc)`. RLS: only service role; bot reads via signed function.
- Verify: `npm run migrate:local` applies cleanly.
- Parallel: yes.

#### Q7 — Log drain endpoint
- File: `app/api/vercel/log-drain/route.ts` (new)
- Change: HMAC-verified POST receiving NDJSON from Vercel. Strips `authorization`/`cookie`/`__session` headers. Writes raw NDJSON to R2 (`logs/<deployment_id>/<hour>.jsonl`). Indexes hot fields in `log_events`.
- Verify: Replay a Vercel log sample (curl with HMAC) → row in `log_events` + object in R2.
- Parallel: yes (after Q6).

#### Q8 — Log search helper
- File: `lib/logs/vercel.ts` (new)
- Change: `searchLogs({ requestId?, since?, level?, route?, limit })` returns `LogEvent[]`. `attachLogsToBrief({ requestId, windowSeconds })` returns a markdown slice for embedding in a dispatch brief.
- Verify: Type-check + a smoke query against seeded rows.
- Parallel: yes (after Q6).

### Pillar 4 — qa-runner service

#### Q9 — Scaffold service skeleton
- Files: `services/qa-runner/{Dockerfile,package.json,playwright.config.ts,docker-compose.yaml,tsconfig.json}` (new)
- Change: Playwright base image, Node entrypoint, single worker by default, headless config.
- Verify: `docker build` succeeds locally.
- Parallel: yes.

#### Q10 — Tier 1 smoke spec
- File: `services/qa-runner/e2e/smoke.spec.ts` (new)
- Change: One spec hitting `/dashboard`, `/forge`, `/board`, `/tools`, `/graph`. For each: status 200, heading exists, no console errors, no 5xx in network.
- Verify: Run against `localhost:3000` with the bot session.
- Parallel: yes.

#### Q11 — Orchestrator
- File: `services/qa-runner/src/index.ts` (new)
- Change: 1) call `/api/admin/issue-bot-session` to get sign-in ticket, 2) launch Playwright with the ticket URL fixture, 3) on failure: fetch last 30 s Vercel logs + recent Sentry events via existing helpers, 4) compose a brief and POST to gateway via `services/claude-gateway/`, 5) write a row to `workflow_feedback` so the existing optimiser loop picks up the result.
- Verify: Manual dry-run with an intentionally broken page.
- Parallel: no (needs Q4–Q10).

#### Q12 — Vercel cron trigger
- File: `app/api/cron/post-deploy-smoke/route.ts` (new)
- Change: Vercel cron POST. Reads `QA_RUNNER_WEBHOOK_URL` + `QA_RUNNER_HMAC_SECRET`. Sends signed POST to qa-runner. Returns immediately (don't block the cron on the Playwright run).
- Verify: Trigger manually; webhook arrives at qa-runner.
- Parallel: yes.

### Pillar 5 — Memory + ops

#### Q13 — Update SECRETS.md
- File: `memory/platform/SECRETS.md`
- Change: Add `BOT_CLERK_USER_ID`, `BOT_API_TOKEN`, `BOT_ISSUER_SECRET`, `QA_RUNNER_WEBHOOK_URL`, `QA_RUNNER_HMAC_SECRET`, `VERCEL_LOG_DRAIN_SECRET`, `CLAUDE_MAX_ONLY`. Mark which live in Doppler vs the qa-runner box.
- Verify: Re-read after write.
- Parallel: yes.

#### Q14 — Update ARCHITECTURE.md
- File: `memory/platform/ARCHITECTURE.md`
- Change: Add `services/qa-runner/`, `app/api/admin/issue-bot-session`, `app/api/vercel/log-drain`, `app/api/cron/post-deploy-smoke`. Wire diagram for the autonomous loop.
- Verify: Re-read after write.
- Parallel: yes.

#### Q15 — qa-runner README + manual-step checklist
- File: `services/qa-runner/README.md` (new)
- Change: Coolify deploy steps, env vars, the Vercel Log Drain config to paste, the Clerk bot user creation steps, smoke-test command. Explicit "you do this manually at the end" checklist.
- Verify: Re-read.
- Parallel: yes.

---

## Phase 3 — Implement

Order:
1. Q1 + Q3 (audit) — Max-only guard.
2. Q4 + Q5 — bot identity (others depend on it).
3. Q6 → Q7 → Q8 — log drain (Q7 depends on Q6, Q8 on Q6).
4. Q9 → Q10 → Q11 — qa-runner service.
5. Q12 — cron trigger.
6. Q2 — migrate research-loop as proof.
7. Q13 + Q14 + Q15 — memory updates + manual checklist.

PDCA gates:
- After Pillar 1 — does `CLAUDE_MAX_ONLY=1` cleanly throw on accidental API use?
- After Pillar 2 — does qa-runner sign in as a real Clerk user via the ticket flow?
- After Pillar 3 — does a sample log row land in both R2 and `log_events`?
- After Pillar 4 — does a forced spec failure trigger a dispatch with logs attached?

## Progress (as of 2026-04-30)

### Completed
- [x] Q1  CLAUDE_MAX_ONLY guard (`lib/claw/llm.ts`)
- [x] Q4  bot bearer-token auth helper (`lib/auth/bot.ts`)
- [x] Q5  Clerk sign-in ticket issuer (`app/api/admin/issue-bot-session/route.ts`)
- [x] Q6  log_events migration (`supabase/migrations/022_log_events.sql`)
- [x] Q7  Vercel log-drain endpoint (`app/api/vercel/log-drain/route.ts`)
- [x] Q8  log search helpers (`lib/logs/vercel.ts`) + `/api/logs/slice` bot endpoint
- [x] Q9  qa-runner scaffold (Dockerfile, package.json, configs, compose)
- [x] Q10 Tier 1 smoke spec (`services/qa-runner/e2e/smoke.spec.ts`)
- [x] Q11 orchestrator (`services/qa-runner/src/{auth,runSpec,dispatch,index}.ts`)
- [x] Q12 cron trigger (`app/api/cron/post-deploy-smoke/route.ts`) + `vercel.json` schedule
- [x] Q2  research-loop migrated to gateway (`inngest/functions/research-loop.ts`)
- [x] Q3  audited remaining `@ai-sdk/anthropic` call sites; added `CLAUDE_MAX_ONLY`
       refusal at `/api/agent`, `/api/build/plan`, `lib/swarm/Queen.ts` (per-task
       generateText + drift check). Already-gateway-first sites untouched.
- [x] Q13 SECRETS.md updated (Autonomous QA + Vercel log drain sections)
- [x] Q14 ARCHITECTURE.md updated (new routes + qa-runner service entries)
- [x] Q15 qa-runner README + manual-step checklist (`services/qa-runner/README.md`)
- [x] Patched `/api/workflow-feedback` to accept the bot bearer token so the
       runner can file feedback rows without a Clerk session.

### Remaining (deferred — requires user environment)
- [ ] Create `qa-bot@<your-domain>` Clerk user — see Q15 checklist step 1.
- [ ] Append bot user_id to `ALLOWED_USER_IDS` in Doppler — Q15 step 2.
- [ ] Generate + set BOT_*, QA_RUNNER_*, VERCEL_LOG_DRAIN_SECRET in Doppler — Q15 step 3.
- [ ] Configure Vercel JSON log drain pointing at `/api/vercel/log-drain` — Q15 step 4.
- [ ] Apply migration `022_log_events.sql` (`npm run migrate`) — Q15 step 5.
- [ ] Deploy `services/qa-runner/` on Coolify next to claude-gateway — Q15 step 6.
- [ ] Smoke-test the end-to-end loop — Q15 step 7.
- [ ] Once stable: set `CLAUDE_MAX_ONLY=1` in Doppler (after a few clean smoke
       runs land through the gateway).

### Follow-up (not in this PR)
- Migrate `lib/swarm/Queen.ts` per-task generateText to a gateway path that
  preserves prompt-cache telemetry (gateway CLI needs to surface
  `cache_creation_input_tokens`/`cache_read_input_tokens`). Tracked at the
  Q3 doc comments.
- Migrate `/api/build/plan` streaming Opus call to a gateway-streaming
  wrapper so `streamText` shape is preserved.
- Tier 2 visual diff spec (deferred until Tier 1 is shown to be stable).
- `lib/library/seed.ts` contains template strings showing the AI SDK usage
  pattern — not a real call site, no migration needed.
