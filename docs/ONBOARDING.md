# Nexus — Owner Onboarding

> **What this is.** Nexus is an autonomous business platform. You bring ideas; AI agents execute. The system researches, builds, publishes, measures, and iterates while you sleep. Your three jobs are: **supply ideas**, **approve work**, and **watch finances**. Everything between those three is automation.
>
> **Who this is for.** Whoever is the **single owner** of a Nexus deployment. The platform is single-tenant by default — `ALLOWED_USER_IDS` pins it to your Clerk user ID and rejects everyone else. You can invite teammates later by appending IDs to the same env var.
>
> **What it is not.** A hosted product. You run Nexus on Vercel + Supabase + a couple of optional sidecars. Costs scale with usage; the fixed cost is roughly $20 (Claude Pro/Max) plus whatever your deploy tier charges (Vercel free tier covers low volume).

---

## 1. Mental model — the three loops

Nexus runs three nested feedback loops. Recognising which loop a task belongs to tells you how it should be approved or automated.

| Loop | Frequency | Owner job | Automation |
|------|-----------|-----------|------------|
| **Idea loop** | Whenever you have one | Capture intent in `/idea` | Forge expands it into a money-model + KPI plan |
| **Execution loop** | Daily | Approve / reject Board cards | `business-operator` agent advances each business one phase per day |
| **Optimisation loop** | Weekly | Review dashboard + finance | Metric optimiser auto-tunes prompts, swaps providers, mutates strategy |

You only ever click on the execution loop (approvals on the Board) and watch the optimisation loop (numbers on the Dashboard). The idea loop is text — paste a thought, get a plan.

---

## 2. Prerequisites (one-time accounts)

Create these once and forget them. Free tiers cover everything until volume scales.

| Service | Why | Sign up |
|---------|-----|---------|
| **Clerk** | Auth | [clerk.com](https://clerk.com) |
| **Supabase** | Database, RLS, Realtime | [supabase.com](https://supabase.com) |
| **Vercel** | Hosting | [vercel.com](https://vercel.com) |
| **Doppler** | Secrets | [doppler.com](https://doppler.com) |
| **Anthropic** | Claude API (only needed if not using the self-hosted gateway) | [console.anthropic.com](https://console.anthropic.com) |

Optional sidecars (skip until needed):
- **Cloudflare R2** — file storage for generated assets
- **Upstash Redis** — rate limiting + cache
- **Inngest** — durable cron + event handlers
- **Resend** — transactional email
- **Sentry** — error tracking
- **Slack** — approval notifications + slash-command approvals from your phone

---

## 3. First deploy (≈ 30 minutes)

### 3.1 Fork & deploy

1. Fork `pinnacleadvisors/nexus` on GitHub.
2. In Vercel, **Import Project** from the fork. Don't add env vars yet — accept defaults; the first deploy will fail and that's expected.
3. Note the deploy URL (e.g. `https://nexus-yourname.vercel.app`).

### 3.2 Clerk

1. Create a Clerk app. Set **Application URL** to your Vercel URL.
2. Copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`.
3. **Configure → Attack protection → Bot sign-up protection: ON.** Cloudflare Turnstile will load on the sign-in page. The CSP in `next.config.ts` already allows `challenges.cloudflare.com`.
4. **User & Authentication → Restrictions → Block sign-ups: ON.** This prevents anyone except you from creating an account. Optionally add your email to the **Allowlist** for a second layer.
5. Open your Vercel URL → sign up with your email or OAuth. You should reach `/dashboard`.
6. Back in Clerk: **Users → click your user → copy the User ID** (format: `user_xxxxxxxxxxxxxxxxxxxxxxxx`).

### 3.3 Supabase

1. Create a Supabase project. From **Project Settings → API** copy:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only, never exposed)
2. Apply migrations. Run `npm run migrate` locally with the URL + service role key, or paste each `supabase/migrations/*.sql` file into the SQL editor in order (001 → 025). Migration 025 is `tasks_lineage` — required for orphan-card cleanup.

### 3.4 Doppler

1. Create a project in Doppler with three configs: `dev`, `stg`, `prd`.
2. Add the env vars listed in `memory/platform/SECRETS.md` for the phase you're deploying. Minimum to boot:
   ```
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
   CLERK_SECRET_KEY
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ALLOWED_USER_IDS=user_xxxxxxxx   # your Clerk user ID from 3.2.6
   OWNER_USER_ID=user_xxxxxxxx       # same value — used by cron jobs
   CRON_SECRET=$(openssl rand -hex 32)
   ENCRYPTION_KEY=$(openssl rand -hex 32)
   ```
3. Connect Doppler → Vercel: **Integrations → Vercel** → select your project → push. Vercel auto-redeploys.

### 3.5 Verify the lock

1. Wait ~60s for Vercel redeploy.
2. Open the URL in an **incognito window**. You should hit the sign-in page.
3. Try signing up with a different email. Clerk should refuse (because of "Block sign-ups").
4. Sign in as yourself. You should reach `/dashboard`.

If a stranger could reach `/dashboard`, stop and re-check `ALLOWED_USER_IDS` — middleware (`proxy.ts`) reads it on every request and the redirect should be immediate.

---

## 4. First business + first idea (≈ 10 minutes)

### 4.1 Seed a business

1. Go to `/settings/businesses`.
2. Click **+ Insert Ledger Lane** (or Inkbound — both are pre-baked seeds in `lib/business/seeds.ts`). This creates a `business_operators` row — niche, money model, KPIs, brand voice all pre-filled.
3. Optional: paste a Slack incoming webhook URL. Nexus posts a verification message and creates a "🔌 Slack connected" card on `/board` so you know it works. If the URL is bad, the field shows a warning instead.

### 4.2 First idea

1. Go to `/idea`.
2. Pick a mode:
   - **Description** — type what you want to build in plain English.
   - **Remodel** — paste a URL of an existing site/product; Nexus will study it and propose a twist.
3. Submit. The forge runs Claude (or your gateway) over the description, inserts a row in `ideas`, and renders a money-model + step plan + tools list.
4. Click **Build this**. This calls `POST /api/runs`, attaches the run to your business, and you land on `/board?runId=...` with a phase banner at the top.

### 4.3 The Board

The Kanban has four columns: **Backlog → In Progress → Review → Completed**. The agent populates **Backlog** with atomic tasks; it pushes them to **Review** as they finish. Your job is **Review** — open a card, look at the asset (link, doc, image, video), click **Approve** or **Reject with feedback**.

Approving advances the run to the next phase. Rejecting routes the task back into the planner with your feedback as input — the next attempt is informed by what you didn't like.

---

## 5. Daily rhythm — three windows

| Window | Where | What you do |
|--------|-------|-------------|
| **Morning (5 min)** | `/board` or Slack | Review overnight cards. Approve / reject. |
| **Mid-week (5 min)** | `/dashboard` | Glance at spend vs revenue, alerts, gateway health. |
| **Weekend (15 min)** | `/dashboard/org` + `/learn` | Look at agent performance trends. Run learn cards if any are due — these are concept flashcards generated from the molecular memory and paired with FSRS-4 spaced repetition so you build durable knowledge of how the platform works. |

You can do everything from your phone. Slack approvals work via `/approve <runId>` and `/reject <runId> <reason>`. The Board is responsive but the Slack flow is faster.

---

## 6. Where things show up when they go wrong

Visible failure surfaces — bookmark these:

| Symptom | Where to look | Typical fix |
|---------|---------------|-------------|
| **No cards on `/board`** after a run | `/manage-platform` health panel → cron status | If cron stuck, click **Run sweep now** |
| **Slack silent** | `/settings/businesses` → field shows red warning if last verify failed | Re-paste webhook URL; Nexus will retry verification |
| **`/learn` empty** | The learn page shows the cron schedule (`0 5 * * *` UTC). Click **Sync now** to run immediately | Cards appear if `mol_atoms` table has rows |
| **"Ephemeral run"** banner on `/board` | Supabase down or service role key wrong | Check Supabase status; rotate `SUPABASE_SERVICE_ROLE_KEY` if needed |
| **Cost cap hit (402)** | Dashboard alert + Slack | Bump `USER_DAILY_USD_LIMIT` or wait for the next UTC day |
| **Board has stale cards** from a deleted idea | Nightly orphan sweep deletes them at 04:30 UTC | Click **Clean orphans now** in `/manage-platform` for immediate cleanup |
| **Cron didn't run** | `/manage-platform` health panel — each cron shows its last-run time | Click the cron's **Run now** button |
| **All crons show "Unknown" in Health panel** | Vercel log drain isn't wired up | Optional setup — see [docs/LOG_DRAIN_SETUP.md](LOG_DRAIN_SETUP.md). Requires Vercel Pro. |

If the dashboard itself won't load, it's probably Clerk: domain whitelist mismatch, or the publishable key changed. The middleware (`proxy.ts`) wraps Clerk in a try/catch so a Clerk outage degrades to "looks signed-out" rather than crashing.

---

## 7. Adding optional capabilities

Each row below is independent — add when you need it.

| Capability | Env vars | Why |
|------------|----------|-----|
| Self-hosted Claude gateway (drains 20× Max plan) | `CLAUDE_CODE_GATEWAY_URL`, `CLAUDE_CODE_BEARER_TOKEN` | Cheaper at scale than per-token API |
| Web search | `TAVILY_API_KEY` | Live research during the idea phase |
| Self-hosted Firecrawl | `FIRECRAWL_BASE_URL` | Scrape + crawl without per-call cost |
| Cinematic video | `KLING_API_KEY` or `RUNWAY_API_KEY` | Generate launch assets |
| Voiceover | `ELEVENLABS_API_KEY` | Audio for video |
| Talking-head | `HEYGEN_API_KEY` (`DID_API_KEY` fallback) | UGC-style content |
| Background music | `SUNO_API_KEY` or `UDIO_API_KEY` | Mood scoring on videos |
| n8n workflow generation | `N8N_BASE_URL`, `N8N_API_KEY`, `N8N_WEBHOOK_SECRET` | Multi-step automation outside Nexus |
| Memory-HQ sync | `MEMORY_HQ_TOKEN`, `MEMORY_HQ_REPO`, `GITHUB_WEBHOOK_SECRET` | Cross-project knowledge graph |
| Stripe revenue | `STRIPE_WEBHOOK_SECRET` | Real revenue on dashboard |
| Sentry error tracking | `SENTRY_DSN` | Hard failures surface in the same place as cron health |

The dashboard's **AI provider status** card shows which of these are configured and reachable. Anything red is something you can wire up later.

---

## 8. Glossary

- **Run** — one execution of an idea through phases (`spec → decompose → build → review → launch → measure → optimise`). Persisted in the `runs` table.
- **Business operator** — agent that runs once per day per `business_operators` row, plans the next 3–7 actions, dispatches them, gates them through Slack approvals.
- **Approval gate** — an action prefix in `business_operators.approval_gates` (e.g. `publish.*`) that requires Slack `/approve` before execution.
- **Atom / MOC** — knowledge graph primitives in `memory/molecular/`. Atoms are facts; MOCs are topic hubs.
- **Phase** — a step in the run state machine. Cards on the board show the current phase in their header.
- **`/manage-platform`** — admin console: cron health, graph rebuild, agent library, audit log.

---

## 9. When things compound (months in)

After a few weeks the system has enough metric history that the optimiser starts proposing prompt changes, model swaps, and even agent edits autonomously. You'll see these as cards in the **Review** column with a `[meta]` prefix. Approving them feeds back into the library — the agent that produced the win gets promoted; the one that failed gets demoted. This is how Nexus gets better at running your business without you doing anything.

The whole point: at month 1 you're approving ~10 cards a day. At month 6, the agent has learned your taste well enough that the volume drops to ~2 cards a day for the same throughput, because rejections are rare.

If the volume isn't dropping, the optimisation loop is broken — check `/dashboard` for stale agent metrics or open `task_plan.md` to see whether SOE Pillar C work has been deployed.

---

## 10. Hand-off (when you eventually invite a teammate)

1. Have them sign up via Clerk (you'll need to lift the **Block sign-ups** restriction temporarily, or add their email to the **Allowlist**).
2. Get their Clerk user ID from the Clerk dashboard.
3. Append to Doppler: `ALLOWED_USER_IDS=user_yours,user_theirs`.
4. Push Doppler → Vercel; wait for redeploy.
5. They can now reach the protected routes; RLS in Supabase still scopes data per-user.

For full multi-tenant (separate businesses per user, separate billing, separate Slack), see `task_plan-platform-improvements.md` — the schema is most of the way there but the surface UI assumes single-owner today.
