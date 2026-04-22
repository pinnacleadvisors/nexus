# Nexus — Environment Variables

> Names only. Values live in Doppler. Never commit values.
> Get Doppler access: `doppler setup` → select project: nexus, config: dev

## Required (platform won't start without these)

| Var | Purpose | Where to get |
|-----|---------|--------------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth (public) | Clerk Dashboard → API Keys |
| `CLERK_SECRET_KEY` | Clerk auth (server) | Clerk Dashboard → API Keys |

## Access Control

| Var | Purpose |
|-----|---------|
| `ALLOWED_USER_IDS` | Comma-separated Clerk user IDs; if set, only these users can access protected routes |

## Database (Phase 7)

| Var | Purpose | Where to get |
|-----|---------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes | Project Settings → API |
| `SUPABASE_PROJECT_REF` | For migrations | Project Settings → General |
| `SUPABASE_ACCESS_TOKEN` | Migration runner | supabase.com/account/tokens |

## AI (Phase 10+)

| Var | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Fallback AI (OpenClaw primary) |
| `OPENCLAW_GATEWAY_URL` | OpenClaw / MyClaw gateway URL |
| `OPENCLAW_BEARER_TOKEN` | Overrides cookie-based OpenClaw auth |

## Rate Limits / Cost

| Var | Default | Purpose |
|-----|---------|---------|
| `CLAW_DAILY_DISPATCH_CAP` | 100 | Max OpenClaw dispatches/day |
| `COST_ALERT_PER_RUN_USD` | 0.50 | Alert threshold per AI run |

## Security (Phase 9)

| Var | Purpose |
|-----|---------|
| `ENCRYPTION_KEY` | AES-256-GCM key for OAuth token encryption (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `UPSTASH_REDIS_REST_URL` | Rate limiter (in-memory fallback if unset) |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiter |

## Storage (Phase 7)

| Var | Purpose |
|-----|---------|
| `R2_ACCOUNT_ID` | Cloudflare R2 |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 |
| `R2_BUCKET_NAME` | Cloudflare R2 bucket (e.g. `nexus-assets`) |
| `R2_PUBLIC_URL` | Optional public R2 URL |

## Integrations

| Var | Phase | Purpose |
|-----|-------|---------|
| `STRIPE_WEBHOOK_SECRET` | 3 | Stripe → real revenue |
| `RESEND_API_KEY` | 3 | Email alerts |
| `ALERT_FROM_EMAIL` | 3 | Verified sender address |
| `SENTRY_DSN` | 3 | Error tracking |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 5 | Google OAuth |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 5 | GitHub OAuth |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | 5 | Slack OAuth |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` | 5 | Notion OAuth |
| `NOTION_API_KEY` | 6 | Notion internal integration (server-side writes) |
| `INNGEST_EVENT_KEY` | 7 | Inngest background jobs |
| `INNGEST_SIGNING_KEY` | 7 | Inngest webhook verification |
| `NEXT_PUBLIC_APP_URL` | 7 | Vercel deployment URL |
| `N8N_BASE_URL` | 13 | n8n instance URL |
| `N8N_API_KEY` | 13 | n8n API key |
| `N8N_WEBHOOK_SECRET` | 13 | n8n webhook HMAC verification |
| `TAVILY_API_KEY` | 17c | Live web search (1k free/mo) |
| `FIRECRAWL_API_KEY` | idea | URL scraper for Remodel-mode idea analyse (500 free/mo) — https://firecrawl.dev |
| `DEERFLOW_BASE_URL` | 17 | DeerFlow sidecar URL (not started) |
| `DEERFLOW_API_KEY` | 17 | DeerFlow auth |
| `DEERFLOW_ENABLED` | 17 | Gates DeerFlow routing in swarm |
| `KLING_API_KEY` | 18 | Kling 2.0 video generation |
| `RUNWAY_API_KEY` | 18 | Runway Gen-4 video |
| `ELEVENLABS_API_KEY` | 18 | Voiceover |
| `HEYGEN_API_KEY` | 18 | UGC / avatar video |
| `DID_API_KEY` | 18 | Talking-head fallback |
| `MUAPI_AI_KEY` | 18 | Scene image generation |
| `SUNO_API_KEY` / `UDIO_API_KEY` | 18 | AI background music |
| `MEMORY_TOKEN` | 20 | GitHub PAT (repo scope) for runtime agent memory |
| `MEMORY_REPO` | 20 | e.g. `pinnacleadvisors/nexus-memory` |

## Agent Library (managed agents)

Defined in `docs/agents/GENERATION_PROTOCOL.md` and `.claude/agents/*.md`.

| Var | Phase | Purpose |
|-----|-------|---------|
| `FIRECRAWL_API_KEY` | agents | Hosted Firecrawl API used by the `firecrawl` managed agent. If unset, the agent falls back to `/firecrawl_local`. |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | agents | Set to `1` to enable Claude Code Agent Teams (swarm). `/api/claude-session/dispatch` injects this into dispatched sessions whenever the n8n node carried `swarm: true`. Unset for normal single-agent runs. |

## AI Priority in `/api/chat`

OpenClaw (Claude Pro via `OPENCLAW_GATEWAY_URL`) → `ANTHROPIC_API_KEY` → error message
