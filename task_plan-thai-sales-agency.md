# Thai Sales Agency — AI Avatar Sales Pipeline (v1)

Goal: Stand up an English-language, Thailand-targeted sales pipeline inside Nexus where an AI avatar runs first-call discovery + demo, leaving the owner only to approve closes from the Board. v1 skips Thai language, AI disclosure, and Zoom-bot bridging — those are explicit follow-ups.

Success criteria:
- A `prospect` entity is discovered, scored, and persisted in Supabase via the existing `runs` state machine — one prospect = one Run, phases: `discover → outreach → booked → call → close`.
- An owner-facing dashboard at `/sales` lists prospects by phase with revenue forecast, and a Board card is created on every booked call so existing review/approval surfaces are reused.
- A prospect clicking the booking link lands on `/sales-call/[id]` and speaks to a HeyGen Streaming Avatar driven by Claude Sonnet 4.6 via the existing Claude Code gateway — no Zoom, no installs.
- Pre-call context pack (audit findings, prior emails, pricing tiers, objection playbook) is hydrated into the avatar's system prompt from the prospect's Run.
- Post-call: avatar collects scope + budget, drops a `proposal-review` Board card with a Stripe checkout link draft; owner approves before any contract goes out.
- Cost ceiling: per-call AI + avatar spend tracked in `metric_samples`; daily cap reuses `cost-guard.ts`.
- `npx tsc --noEmit` passes; happy-path integration test for the prospect → call → proposal chain.

Hard constraints:
- Stack rules in `AGENTS.md` / `memory/platform/STACK.md` (Next.js 16 App Router, `proxy.ts`, `'use client'` boundary, types in `lib/types.ts`, no `tailwind.config.js`).
- Reuse existing surfaces — no parallel state machines, no new auth, no new Board. Every prospect is a `Run`; every approval is a Board card; every AI call goes through `lib/claw/business-client.ts`.
- All new mutation routes: `auth()` → `ratelimit()` → CSRF origin check → `audit.log()`. Every new env var added to `memory/platform/SECRETS.md`.
- Branch: `claude/ai-avatar-sales-research-ug2fM`. No auto-merge to main; human gate at Board stays authoritative.
- Write Size Discipline: every atomic task fits in one Write/Edit under 300 lines. Multi-section files are scaffolded then filled per-section.
- v1 explicit non-goals: Thai language, AI disclosure copy, Zoom/Meet bot bridging, LINE outreach, Omise/2C2P payments, ICP-filed mainland China deployment.

---

## Phase 1 — Explore (findings)

### Assets we reuse (do not rebuild)

| Surface | Path | How v1 uses it |
|---|---|---|
| Run state machine | `supabase/migrations/015_runs.sql`, `lib/runs/controller.ts`, `lib/types.ts` (`Run`, `RunPhase`, `RunEvent`) | One `Run` per prospect. Phases extended: `discover → outreach → booked → call → close`. |
| `/api/runs` CRUD + events | `app/api/runs/route.ts` + `[id]/` | Lead-prospector + sdr-agent + avatar all call `appendEvent` for audit trail. |
| Claude Code gateway (plan-billed) | `services/claude-gateway/`, `lib/claw/business-client.ts`, `CLAUDE_CODE_GATEWAY_URL` | Drives the avatar's brain at zero marginal token cost. Falls back to OpenClaw → API key per existing precedence. |
| Tavily live search | `lib/tools/tavily.ts`, `TAVILY_API_KEY` | Lead-prospector queries `site:.co.th -www.lighthouse-* "contact"` etc. and resolves company sites. |
| Resend email | `RESEND_API_KEY` | sdr-agent sends personalised cold-outreach + booking confirmations. |
| Board + ReviewModal | `app/(protected)/board/`, `components/board/{KanbanCard,ReviewModal}.tsx` | New card kinds: `prospect-outreach`, `call-booked`, `proposal-review`. ReviewModal already has approve/reject + "Quality feedback" disclosure that feeds `workflow-optimizer`. |
| Forge → Run wiring | `components/forge/ForgeActionBar.tsx` → `POST /api/runs` → `/board?runId=` | Pattern reused by lead-prospector → outreach Run. |
| Cost guard | `lib/cost-guard.ts`, `USER_DAILY_USD_LIMIT`, `COST_ALERT_PER_RUN_USD` | Wraps avatar session cost (HeyGen mins + Claude tokens). Per-call hard cap added. |
| `metric_samples` + observability | `lib/observability.ts`, migration 017 | Records call-duration, tokens, HeyGen seconds, conversion outcome. Feeds Pillar A measure-phase. |
| `workflow-optimizer` agent | `.claude/agents/workflow-optimizer.md`, `app/api/workflow-feedback/route.ts` | Feedback from "owner reviewed call recording" loops back to sdr-agent / objection playbook agent. |
| Audit log | `lib/audit.ts` | Every prospect-touching mutation logs `actor`, `target`, `action`. |
| n8n strategist | `.claude/agents/n8n-strategist.md`, `/api/n8n/generate` | Once a prospect closes, idea-card flips to "build" mode and the existing n8n workflow generator scaffolds delivery — no new code needed for the post-close path. |

### Gaps v1 must fill

1. **No `prospects` table.** Need a Supabase table keyed by `run_id` with: business_name, website, contact_email, audit JSON (Lighthouse score, missing_widgets, last_post_date), owner_country, segment, status, value_estimate.
2. **No avatar provider client.** Phase 18 lists `HEYGEN_API_KEY` but no code path. Need `lib/avatar/heygen.ts` with `createSession`, `sendUtterance(text)`, `endSession` matching HeyGen Streaming Avatar API.
3. **No real-time conversation loop.** Need a `/sales-call/[id]` page (Client Component) that: opens HeyGen LiveKit session in browser, streams prospect audio to Whisper or HeyGen ASR, sends transcript turn to `/api/avatar/turn` (server), which calls Claude with hydrated context pack, returns text, page calls `sendUtterance` to make avatar speak. Latency budget ~800ms.
4. **No lead-prospector agent.** Needs to scrape TH SMB candidates, score them via Lighthouse + signals (no booking widget, stale blog, lapsed FB ads), and write to `prospects`. Tavily + a small `lib/audit/lighthouse.ts` wrapper around PageSpeed Insights API (free tier is enough for v1).
5. **No sdr-agent.** Drafts cold email referencing audit findings, sends via Resend, tracks opens/replies via Resend webhooks → updates Run.
6. **No Cal.com hookup.** Inbound webhook `/api/webhooks/calcom` matches event to a `prospect.run_id` (via UTM or pre-fill) and advances Run to `booked`.
7. **No context pack hydrator.** `lib/sales/context-pack.ts` builds the system prompt from: prospect record, prior outreach emails, pricing tier table (new `lib/sales/pricing.ts`), objection playbook (new markdown in `memory/sales/objections.md`).
8. **No proposal generator.** Post-call: `lib/sales/proposal.ts` takes call transcript + collected scope/budget, drafts a one-page proposal markdown + Stripe checkout link draft (does NOT publish — owner must approve).
9. **No `/sales` dashboard page.** Owner-facing list of prospects by phase + revenue forecast. Reuses `KpiGrid` + `AgentTable` components with new data source.
10. **No new env vars surfaced.** Need to add: `HEYGEN_API_KEY` (already listed but verify in Doppler), `PAGESPEED_API_KEY` (free Google), `CALCOM_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`. Stripe keys already exist for revenue tracking.

### Risks + invisible contracts

- **HeyGen Streaming Avatar minutes are billed even on dropped sessions.** Wrap session create/end in try/finally with a hard 20-min timeout in `lib/avatar/heygen.ts`. Without this a runaway tab can burn $10+/hour.
- **`Run.phases` enum is a Postgres `text` column today** (per migration 015). Adding `discover`/`outreach`/`booked`/`call`/`close` is a code-only change but check `lib/runs/controller.ts` for any phase-name allow-list.
- **`/api/chat` already enforces auth + cost cap (B1, B9).** New `/api/avatar/turn` route MUST mirror those guards — easiest is `withGuards` wrapper if B8 lands first; else copy the pattern explicitly.
- **Resend webhook signature verification is HMAC-SHA256 over raw body** — Next 16 App Router handlers default to parsed JSON. Use `req.text()` then verify, then `JSON.parse`.
- **Cold outreach to Thai businesses via cold email has a Section 33 PDPA angle** — for v1 (English-speaking targets, mostly expat-owned or international SMBs) use a published-business-email-only rule and include unsubscribe link. Document in `memory/sales/compliance.md`.
- **Lighthouse/PageSpeed Insights API free tier is 25,000 queries/day** — fine, but cache results in `prospects.audit` so re-scoring doesn't re-call.
- **HeyGen Interactive Avatar v2 returns a LiveKit token** — the page needs `livekit-client` (~80KB gzipped). Add to `package.json` and verify it's tree-shaken into the `/sales-call` route only.

### Test surface (what we actually need to assert)

- `POST /api/prospects` with auth → row inserted, Run created, audit log entry.
- `POST /api/avatar/turn` with valid `runId` + transcript → returns Claude reply, appends `RunEvent`, increments `metric_samples`.
- Cal.com webhook with valid signature → Run advances to `booked`, Board card created.
- HeyGen session timeout (20 min) → session.end called, no leaked minutes.
- `/sales-call/[id]` renders Client-only (no SSR break on `livekit-client`).

---

## Phase 2 — Plan (atomic tasks)

> Each task is 2–5 minutes of focused work, fits one Write/Edit under 300 lines, and ends with a Verify step. `Parallel: yes` tasks dispatch to subagents simultaneously after Slice 0 lands.

### Slice 0 — schema + types (sequential, blocks everything)

#### Task 0.1 — Add Prospect & SalesCall types `[types]`
- File: `lib/types.ts`
- Change: add `Prospect`, `ProspectAudit`, `SalesCall`, `Proposal`, `OutreachMessage` interfaces; extend `RunPhase` union with `'discover' | 'outreach' | 'booked' | 'call' | 'close'`.
- Verify: `npx tsc --noEmit`.
- Parallel: no.

#### Task 0.2 — Migration: prospects + sales_calls + proposals tables `[db]`
- File: `supabase/migrations/019_thai_sales.sql` (new)
- Change: 3 tables — `prospects (id, run_id FK, business_name, website, contact_email, audit jsonb, country, segment, value_estimate_usd, status, created_at, owner_user_id)`, `sales_calls (id, prospect_id FK, heygen_session_id, started_at, ended_at, transcript jsonb, outcome)`, `proposals (id, sales_call_id FK, scope_md, price_usd, stripe_checkout_url, status, approved_by, approved_at)`. RLS: owner-user-id only.
- Verify: `supabase db push --dry-run` shows clean diff; `npx tsc --noEmit` after `supabase gen types typescript`.
- Parallel: no.

#### Task 0.3 — Seed pricing tiers + objection playbook `[content]`
- Files: `lib/sales/pricing.ts` (new), `memory/sales/objections.md` (new)
- Change: pricing.ts exports 3 tiers (Website Refresh $1.5k, Automation Pack $3k, Growth Engine $7.5k/mo) with deliverables array. objections.md is a markdown table — objection → response framing → fallback.
- Verify: file readable; pricing imported in a throwaway test compile.
- Parallel: no.

### Slice 1 — discovery + outreach (parallel-safe after Slice 0)

#### Task 1.1 — `lib/audit/lighthouse.ts` PageSpeed wrapper `[lib]`
- File: `lib/audit/lighthouse.ts` (new)
- Change: `auditUrl(url): Promise<ProspectAudit>` calls PageSpeed Insights API with `PAGESPEED_API_KEY`, returns `{ performance, seo, has_booking_widget: boolean, last_modified }`. 25k/day quota — no rate-limit needed for v1.
- Verify: unit-style call against `https://example.com` returns shape.
- Parallel: yes.

#### Task 1.2 — `lib/sales/lead-prospector.ts` `[lib]`
- File: `lib/sales/lead-prospector.ts` (new)
- Change: `discoverProspects({ segment, country='TH', limit=10 })` → Tavily search → for each result, `auditUrl()` → score → returns scored candidates. No DB write here (caller decides).
- Verify: returns ≥1 scored candidate against a known seed query.
- Parallel: yes.

#### Task 1.3 — `lead-prospector` managed agent spec `[agent]`
- File: `.claude/agents/lead-prospector.md` (new) + `agent_library` upsert via `POST /api/agents`
- Change: spec frontmatter — tools: Read, Bash, WebFetch; description triggers on "find leads", "prospect", "discover businesses". Body wraps `lib/sales/lead-prospector.ts` with structured output to `prospects` table via `/api/prospects`.
- Verify: agent spec lints; appears in agent_library.
- Parallel: yes.

#### Task 1.4 — `POST /api/prospects` route `[api]`
- File: `app/api/prospects/route.ts` (new)
- Change: `auth()` → `ratelimit('prospects')` → CSRF check → insert prospect → create Run via `controller.createRun({ kind: 'sales-prospect', initialPhase: 'discover' })` → `audit.log` → 201.
- Verify: curl with valid Clerk session inserts row; without auth returns 401.
- Parallel: yes (after 0.1, 0.2).

#### Task 1.5 — `lib/sales/sdr-agent.ts` outreach drafter `[lib]`
- File: `lib/sales/sdr-agent.ts` (new)
- Change: `draftOutreach(prospect, audit)` → calls Claude via `business-client` with a tight system prompt referencing pricing tiers + audit findings → returns `{ subject, body_md }`. Also `sendOutreach(prospect, draft)` uses Resend, appends `outreach-sent` RunEvent.
- Verify: dry-run returns plausible English subject/body for a stubbed prospect.
- Parallel: yes.

#### Task 1.6 — `POST /api/webhooks/resend` (open/reply tracking) `[api]`
- File: `app/api/webhooks/resend/route.ts` (new)
- Change: verify HMAC sig with `RESEND_WEBHOOK_SECRET`, parse event, append `outreach-opened` / `outreach-replied` RunEvent, advance phase if reply.
- Verify: signed test payload accepted; unsigned rejected 401.
- Parallel: yes.

### Slice 2 — booking + avatar call (sequential within slice; depends on Slice 0)

#### Task 2.1 — `POST /api/webhooks/calcom` `[api]`
- File: `app/api/webhooks/calcom/route.ts` (new)
- Change: verify `CALCOM_WEBHOOK_SECRET`, match `runId` from Cal.com `responses.runId` custom field, advance Run to `booked`, insert `sales_calls` row, create Board card via existing card API.
- Verify: signed sample webhook → Run state shows `booked`, Board card visible.
- Parallel: no.

#### Task 2.2 — `lib/avatar/heygen.ts` client `[lib]`
- File: `lib/avatar/heygen.ts` (new)
- Change: `createSession({ avatarId, voiceId })` returns `{ session_id, livekit_url, livekit_token }`; `sendUtterance(session_id, text)`; `endSession(session_id)`. Uses `HEYGEN_API_KEY`. Hard 20-min timeout via `setTimeout` returning a token that callers can clear.
- Verify: against HeyGen sandbox returns valid LiveKit token (run once manually).
- Parallel: yes.

#### Task 2.3 — `lib/sales/context-pack.ts` hydrator `[lib]`
- File: `lib/sales/context-pack.ts` (new)
- Change: `buildContextPack(prospectId)` reads prospect + audit + last 3 OutreachMessages + pricing tiers + objections.md → returns a single system-prompt string ≤ 8k tokens. Caches via prompt-cache marker.
- Verify: returns string with all sections; token count under cap.
- Parallel: yes.

#### Task 2.4 — `POST /api/avatar/session` create + `DELETE` end `[api]`
- File: `app/api/avatar/session/route.ts` (new)
- Change: POST `auth()` + `ratelimit` + `costGuard` (estimated 30 min × $0.40) → `createSession` → store `heygen_session_id` on `sales_calls` → return `{livekit_url, livekit_token, session_id}`. DELETE → `endSession` + record final duration in `metric_samples`.
- Verify: POST returns token; DELETE closes; metric row written.
- Parallel: no (depends on 2.2).

#### Task 2.5 — `POST /api/avatar/turn` Claude turn handler `[api]`
- File: `app/api/avatar/turn/route.ts` (new)
- Change: `auth()` + `ratelimit('avatar-turn', { perMinute: 60 })` → load context pack (Task 2.3) → call Claude via `business-client` with prompt cache hint → call `sendUtterance` → append `RunEvent('turn', { user, assistant })` → return `{ reply }`.
- Verify: curl with mocked transcript returns reply within 1s p50.
- Parallel: no.

#### Task 2.6 — `app/(protected)/sales-call/[id]/page.tsx` `[ui]`
- File: `app/(protected)/sales-call/[id]/page.tsx` (new, Server Component shell only)
- Change: fetches `sales_calls` row + prospect, renders `<SalesCallRoom>` Client Component with props.
- Verify: renders without hydration error.
- Parallel: yes.

#### Task 2.7 — `components/sales/SalesCallRoom.tsx` (Client) `[ui]`
- File: `components/sales/SalesCallRoom.tsx` (new, `'use client'`)
- Change: opens LiveKit room with token from `/api/avatar/session`, captures mic via Web Speech API or browser ASR, on each final transcript POSTs to `/api/avatar/turn`, displays avatar video stream + live transcript. Cleanup on unmount calls DELETE.
- Verify: locally — talk into mic, avatar lipsyncs reply within ~1.5s.
- Parallel: no (depends on 2.6).

### Slice 3 — close + handoff (depends on Slice 2)

#### Task 3.1 — `lib/sales/proposal.ts` generator `[lib]`
- File: `lib/sales/proposal.ts` (new)
- Change: `generateProposal(salesCallId)` reads transcript → Claude extracts scope + budget → matches to pricing tier → drafts proposal markdown → creates Stripe Checkout link in `mode: 'payment'` (or `subscription` for monthly tier) → inserts `proposals` row with `status: 'pending-owner-approval'`.
- Verify: against a fixture transcript, returns proposal with valid Stripe URL.
- Parallel: yes (after Slice 2 lands).

#### Task 3.2 — Board card kind `proposal-review` + ReviewModal hook `[ui]`
- File: `components/board/ReviewModal.tsx` (edit)
- Change: when `card.kind === 'proposal-review'`, render proposal markdown + Stripe link preview + Approve / Reject. Approve POSTs to `/api/proposals/[id]/approve` which sends the link to prospect via Resend.
- Verify: card renders; approve flow sends test email.
- Parallel: no.

#### Task 3.3 — `POST /api/proposals/[id]/approve` `[api]`
- File: `app/api/proposals/[id]/approve/route.ts` (new)
- Change: `auth()` + owner-only check → mark `approved`, send Resend email with checkout link, advance Run to `close`, log audit.
- Verify: unauthorised user gets 403; owner approval triggers email.
- Parallel: no.

### Slice 4 — visibility + safety (parallel after Slice 3)

#### Task 4.1 — `app/(protected)/sales/page.tsx` dashboard `[ui]`
- File: `app/(protected)/sales/page.tsx` (new) + `components/sales/ProspectTable.tsx`
- Change: lists prospects grouped by phase, shows revenue forecast (sum of `value_estimate_usd` weighted by phase). Reuses `KpiGrid`.
- Verify: renders for owner with seed data.
- Parallel: yes.

#### Task 4.2 — Sidebar nav entry `[ui]`
- File: `components/layout/Sidebar.tsx` (edit)
- Change: add "Sales" link with `Briefcase` icon (verify exists in lucide-react first).
- Verify: link routes to `/sales`.
- Parallel: yes.

#### Task 4.3 — Update `memory/platform/SECRETS.md` + `memory/platform/ARCHITECTURE.md` `[memory]`
- Files: both (edit)
- Change: add Phase TS (Thai Sales) section listing `HEYGEN_API_KEY`, `PAGESPEED_API_KEY`, `CALCOM_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`. Architecture: new routes + new lib dirs.
- Verify: files saved; INDEX.md still accurate.
- Parallel: yes.

#### Task 4.4 — Update `memory/roadmap/SUMMARY.md` `[memory]`
- File: `memory/roadmap/SUMMARY.md` (edit)
- Change: add row "TS | Thai Sales Agency v1 | 🔧" linking to this plan.
- Verify: row visible; PENDING.md updated with the ⬜ items (disclosure, Thai language, LINE, Omise, Zoom-bot).
- Parallel: yes.

#### Task 4.5 — ADR: Avatar provider choice (HeyGen) `[docs]`
- File: `docs/adr/NNN-heygen-streaming-avatar.md` (new) + `docs/adr/INDEX.md` (edit)
- Change: documents why HeyGen Interactive over Tavus for v1 (Phase 18 env var precedent + LiveKit-based SDK + better English voice catalog), and what would trigger a swap to Tavus (latency p95 > 1.2s on real calls).
- Verify: linked from INDEX.md.
- Parallel: yes.

#### Task 4.6 — Happy-path integration test `[test]`
- File: `__tests__/sales-pipeline.test.ts` (new)
- Change: stubs Tavily + PageSpeed + Resend + HeyGen + Stripe; runs full chain `discoverProspects → /api/prospects → /api/webhooks/calcom → /api/avatar/session → /api/avatar/turn × 3 → /api/avatar/session DELETE → generateProposal`. Asserts Run phase transitions + metric_samples rows.
- Verify: test passes locally.
- Parallel: no (final gate).

### Out of scope for v1 (explicit follow-ups)

- Thai language support (avatar voice + Claude system prompt + pricing in THB)
- AI disclosure copy + recorded-call consent banner
- Zoom/Meet bot bridging via Recall.ai or Joinly
- LINE Messaging API outreach channel
- Omise / 2C2P payment rails (Stripe-only for v1)
- Avatar fine-tune on owner's likeness (v1 uses HeyGen stock English-male/female avatar — owner picks one)
- Recording storage in R2 + transcript search

### Dependency graph

```
Slice 0 (schema)
   ├─► Slice 1 (discovery + outreach)   [tasks 1.1–1.6 parallel]
   └─► Slice 2 (booking + call)         [2.1 → 2.2 → 2.3,2.4 → 2.5 → 2.6 → 2.7]
                                            │
                                            └─► Slice 3 (close)
                                                    │
                                                    └─► Slice 4 (visibility + tests)
```

### PDCA gates (do not skip)

- After Slice 0 → does the schema + types match the North Star? Stop if Run-phase coupling is wrong.
- After Slice 1 → does a real Tavily query yield a usable scored prospect? If signal is weak, revise scoring before building outreach on top.
- After Slice 2 → manual end-to-end call with the owner as prospect; latency p50 < 1s? If not, revisit avatar provider before Slice 3.
- After Slice 4 → does `npx tsc --noEmit` pass and integration test green? PR opens as draft only after both pass.


---

## Progress

_Updated as work lands. Format: `## Progress (as of YYYY-MM-DD)` per CLAUDE.md._
