# Nexus — Onboarding

> A 30-minute walkthrough from "I just signed up" to "I have an autonomous business running". Aimed at the platform owner today, and at multi-tenant testers later.

---

## What Nexus does, in one paragraph

Nexus is a single-owner business automation platform. You drop ideas into the **Idea** page and Claude analyses each one — costs, revenue, automation %, build steps, maintain steps. Hit **Run** and Nexus generates two n8n workflows (Build + Maintain) plus a persistent **Run** that drives a Kanban board through phases (`ideate → spec → decompose → build → review → launch → measure → optimise`). Specialist agents do the work. The **Board** shows you what the agents produced. You **approve or reject** each card. A nightly **Business Operator** cron emits the next 3–7 actions for each business and posts a Slack digest with inline Approve / Reject buttons. Your job is three things only: **supply ideas, approve work, watch finances.** Everything else is the platform's responsibility.

---

## What you'll need before you start

| Item | Where | Why |
|---|---|---|
| Clerk account | [clerk.com](https://clerk.com) | Auth & user identity |
| Doppler workspace | [doppler.com](https://doppler.com) → project `nexus`, config `dev` and `prd` | Secrets management — never use `.env` files |
| Supabase project | [supabase.com](https://supabase.com) | Postgres + Realtime |
| Vercel project | [vercel.com](https://vercel.com) | Hosting + cron + log drain |
| Optional now: Slack workspace, Cloudflare R2, Stripe, Resend | as you go | Outbound surfaces |

---

## Step 1 — Create your Clerk account

1. Open the deployed URL (your Vercel deployment, e.g. `https://nexus-xxx.vercel.app`).
2. Sign up with email or Google/GitHub OAuth.
3. Verify your email if prompted.
4. In Clerk Dashboard → **Users** → click your row → copy the **User ID** (`user_xxxxxxxxxxxxxxxxxxxxxxxx`).

## Step 2 — Lock the platform to yourself

In Doppler (or Vercel env vars) set:

```
ALLOWED_USER_IDS=user_xxxxxxxxxxxxxxxxxxxxxxxx
```

Comma-separated. Anyone authenticated whose ID is not on this list is redirected to sign-in. `proxy.ts` enforces this.

In Clerk Dashboard → **User & Authentication → Restrictions** also enable **"Block sign-ups"**. Defence-in-depth.

## Step 3 — Set the required env vars

The minimum to boot Nexus:

| Variable | Get from | Required? |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk → API Keys | yes |
| `CLERK_SECRET_KEY` | Clerk → API Keys | yes |
| `ALLOWED_USER_IDS` | Step 1 above | yes (single-owner) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | yes |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | yes (production) |
| `CRON_SECRET` | `openssl rand -hex 32` | yes |

Recommended next:

| Variable | Why | Required? |
|---|---|---|
| `CLAUDE_CODE_GATEWAY_URL` + `CLAUDE_CODE_BEARER_TOKEN` | Plan-billed Claude (drains your 20× Max plan) | strongly recommended |
| `ANTHROPIC_API_KEY` | Final fallback when gateway is offline | recommended |
| `TAVILY_API_KEY` | Live web search | recommended |
| `FIRECRAWL_API_KEY` | Page scraping for the idea analyser | recommended |
| `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` | Background jobs (business-operator daily cron) | recommended |
| `NEXT_PUBLIC_APP_URL` | Used by Slack links, post-deploy hooks | recommended |

The full list lives in `memory/platform/SECRETS.md`. Don't paste any value into a file — store everything in Doppler.

## Step 4 — Apply the Supabase migrations

```bash
npm run migrate
```

This applies every file in `supabase/migrations/`. After running:

```sql
-- in the Supabase SQL editor
select count(*) from schema_migrations;
```

You should see ≥ 27 rows.

## Step 5 — First idea

1. Open `/idea` (it's in the sidebar as **Ideas**).
2. Pick a mode:
   - **Remodel** — paste a URL (e.g. an existing project or competitor). Firecrawl scrapes it, Tavily benchmarks the niche, Claude estimates cost / revenue / automation %.
   - **Description** — describe an idea in plain English.
3. Hit **Analyse idea**. You'll see a card with: revenue estimate, setup cost, automation %, "likely / unlikely / uncertain" verdict, and a list of build + maintain steps with which are automatable.
4. The card persists to Supabase (`ideas` table) so it survives a refresh.

## Step 6 — First Run

1. On the idea card, hit **▶ Run**.
2. A modal appears. Optionally type extra detail ("use Supabase, target Thai market, brand voice = founder").
3. Hit **Generate workflows**.
4. Nexus does three things:
   - Creates a `runs` row that ties everything together.
   - Generates a **BUILD** n8n workflow for first-time setup.
   - Generates a **MAINTAIN & PROFIT** n8n workflow for steady-state.
5. You're redirected to the **Board** with `?runId=<id>` — the active-run banner shows the current phase.

## Step 7 — First review

The agents will start producing artefacts (research docs, copy, code, designs) and dropping them into the **Review** column. For each card:

1. Click the card → review modal opens with the asset preview.
2. **Approve** → moves to Completed, dispatches the next task in the pipeline.
3. **Reject** → moves back to Backlog with your revision note attached. The optimizer agent reads these notes.

## Step 8 — First business

When an idea has matured (≥ 1 launched product), promote it to a managed business so the daily operator runs it:

1. Open `/settings` → **Businesses**.
2. Click a seed template (or insert a new row via the API).
3. Fill in the **Slack channel** display name and the **Slack webhook URL** (incoming webhook pinned to that channel).
4. Saving the row triggers a verification message ("✅ Nexus connected to <Business>"). If it fails, you see an inline error with retry. On success, a Board card titled "🔌 <Business> — Slack connected" appears in Review.
5. Daily at 04:00 UTC (11:00 ICT) the `business-operator` agent dispatches via Inngest. It reads the row, assesses memory + recent run events + Board state, and posts a digest with 3–7 actions for the day. Actions matching `approval_gates` (e.g. `spend.`, `publish.brand.`) carry inline Approve / Reject buttons. Click them in Slack — Nexus verifies the signing secret and advances the linked Run.

## Step 9 — Watching finances

`/dashboard` (Mission Control) shows:
- KPI grid (revenue, cost, MRR, etc.)
- Today's spend vs `USER_DAILY_USD_LIMIT` cap (default $25 / day).
- Active runs panel + Pending reviews + Worst offenders.
- Failures badge (PR 5) → links to `/manage-platform/health` for full diagnostics.

When a card hits Review, you also receive a Slack ping (if configured).

---

## Where to look when something breaks

The **single source of truth** for "is anything wrong?" is `/manage-platform`:

| What | Where | What you'll see |
|---|---|---|
| Cron is stuck | Health Panel → Cron rows | red row when last successful run is too old |
| Webhook is dead | Health Panel → Webhook rows | amber/red on `webhook_last_error` |
| Gateway is offline | Health Panel → Gateway pill | red — falls back to OpenClaw / API automatically |
| Run failed or blocked | Failed Runs section | links to event log |
| Idea persistence broke | "Ephemeral run" banner on `/idea` | DB unreachable → run was created in memory only |
| n8n workflow import failed | Automation Library → import error column | re-import button |

Mission Control shows a small "X failures · view" badge that deep-links to `/manage-platform`.

---

## Manual steps you can't avoid

These require human action — Nexus surfaces a manual Board card for each:

1. **OAuth refresh tokens** — YouTube, TikTok, Instagram, Notion, Google Drive. One-time per integration, refreshed automatically thereafter.
2. **Stripe webhook secret** — paste once into Doppler.
3. **Slack signing secret + webhook URL per business** — once per business.
4. **Domain registration / DNS / brand assets** — buying a domain, picking a logo.
5. **Real-money decisions** — anything matching an `approval_gate` (paid spend, brand voice, strategic pivots, refunds).
6. **Adding the platform owner allowlist** — `ALLOWED_USER_IDS` stays in Doppler; updating it after inviting a tester is manual.
7. **Migrations** — `npm run migrate` after pulling new code.

Everything else is automated.

---

## Inviting a second person (multi-tenant)

Today the platform is single-owner by design. Before inviting a second user:

1. Set `MULTI_USER_MODE=1` in Doppler — this gates RLS narrowing + per-route auth.
2. Re-run migrations (`028_rls_narrow.sql` activates).
3. Append the new tester's Clerk user ID to `ALLOWED_USER_IDS`.
4. Verify the audit log shows their actions scoped to their own rows.

When you flip the flag off, behaviour reverts. See `docs/adr/003-protected-route-matcher.md` for the auth model.

---

## Drift watcher

A weekly cron (`/api/cron/onboarding-drift`) compares the env vars listed in `memory/platform/SECRETS.md` against the ones in this file. When new vars are added but not documented here, it files a `workflow_feedback` row so the doc stays in sync. Don't fight the watcher — let it tell you when this file is stale.
