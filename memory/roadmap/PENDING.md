# Nexus — Pending Items

> All ⬜ not-started items, grouped by phase. Source of truth: `ROADMAP.md`.

## Phase 2 — Idea Forge

- Save/resume sessions — persist conversations + milestones to Supabase (currently localStorage)
- Multi-business support — named projects, switch between them (currently localStorage)

## Phase 3 — Dashboard

- Connect to real Supabase data (scaffold complete; run `npm run migrate` + set Supabase vars)
- Stripe webhook → real revenue figures (endpoint exists at `/api/webhooks/stripe`; set `STRIPE_WEBHOOK_SECRET`)
- Sentry integration (install `@sentry/nextjs` + set `SENTRY_DSN`)

## Phase 5 — OpenClaw Integration

- ~~OAuth token storage → migrate from cookies to encrypted DB column~~ ✅ B10 (2026-04-24)
- ~~Security audit on OAuth proxy and token handling~~ ✅ B1–B10 pass

## Phase 12 — Tribe v2

- Content analytics — connect CTR/shares/time-on-page back to neuro score; surface correlation on dashboard
- muapi.ai media pairing — auto-generate matching image after content generation; attach to board card

## Phase 14 — 3D Knowledge Graph

- Embed minimap 2D projection in Forge sidebar; deep-link on click (Phase 14b)

## Phase 16 — Org Chart

- Supabase Realtime subscription on `agents` channel (replace 15s polling)
- Accountability chain — Board card detail links to spawning agent + queen (Phase 16b)
- Agent utilisation stacked bar chart on Dashboard (Phase 16b)

## Phase 17 — DeerFlow 2.0

- **17a**: Deploy DeerFlow 2.0 sidecar on Railway (~$25–50/mo); set `DEERFLOW_BASE_URL` + `DEERFLOW_API_KEY` + `DEERFLOW_ENABLED`
- **17b**: `lib/deerflow/client.ts` — swarm routing hook in Queen.ts, researcher + coder agent upgrades, cost tracking, DeerFlow status page

## Phase 18 — Video Generation Pipeline

- **18a**: Scene assembly — n8n workflow stitches Kling/Runway clips via FFmpeg
- **18b**: ElevenLabs voiceover (`lib/audio/elevenlabs.ts`), voice profile store, Suno/Udio background music, FFmpeg audio mix, lip-sync
- **18c**: HeyGen avatar library + product demo mode; D-ID fallback; muapi.ai scene images
- **18d**: Video storage to R2, board card auto-creation, video player in Review modal, platform export (9:16/1:1/16:9), video dashboard widget

## Phase 19 — Nexus Builds Nexus

- ~~Diff viewer — Board Review card shows git diff; approve (merge) or reject (close branch) from UI~~ ✅ A12 (`components/board/DiffViewer.tsx`)
- Error paste mode — paste TS/Next.js error → agent diagnoses via graph → proposes fix → dispatches
- CI status badge — show Vercel deploy status on Board card; auto-create fix task on deploy failure

## Phase 20 — Memory Engine

- Notion sync (optional) — one-way push to Notion after each GitHub write when `NOTION_TOKEN` set

## Phase 21 — OSS-First Stack (all not started)

Priority order:
1. **21a** — Brevo email (drop-in Resend replacement for >3k/mo)
2. **21b** — Umami analytics (self-host, `docker run umami-software/umami`)
3. **21c** — GlitchTip error tracking (Sentry-compatible)
4. **21d** — Coolify hosting (when Vercel free tier limits hit)
5. **21e** — Coqui TTS (local voiceover, no per-char cost)
6. **21f** — SadTalker / Wav2Lip (local talking-head)

## Phase 22 — Leiden Algorithm Migration

- Implement `lib/graph/leiden.ts` (~200 lines TypeScript) to replace Louvain in `lib/graph/builder.ts` → `assignClusters()`
- Benefits: well-connected communities (no disconnected nodes), deterministic output, higher modularity
- No new packages needed (pure TS port of Leiden)

## Self-Optimising Ecosystem (SOE) — remaining

Tracked in `task_plan.md`. Cross-references to `memory/roadmap/SUMMARY.md`.

### Pillar A — loop closure
- **A5** — Forge "Build this" button must `POST /api/runs { ideaId }` then route to `/board?runId=...`. If a run already exists for the idea, resume. Currently the button does not create a run row.

### Pillar B — security hardening
- **B8** — Introduce `lib/withGuards.ts` that composes `assertOrigin` + `auth()` + `ratelimit()` + optional `costCap`; migrate the 10 most-called mutating routes. Start behind a feature flag.
- **B11** — Wire `scripts/scan-secrets.sh` into a `.husky/pre-commit` hook (install husky, drop-in hook file). Without the hook the script is documentation, not enforcement.
- **B12** — Audit every public surface (sign-in, OAuth callback, webhooks) for distinct rate-limit buckets so a single abuser can't DOS auth. Document the strategy in `lib/ratelimit.ts`.

### Pillar A — post-A5 follow-ups
- Final launch/publish human-gated step in the forge→board flow (tie into A10 providers)
- Fill in TikTok + Instagram providers once app review clears (stubs in `lib/publish/`)
