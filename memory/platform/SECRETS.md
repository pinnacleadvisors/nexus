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
| `CLAUDE_CODE_GATEWAY_URL` | **Primary.** Self-hosted Claude Code instance on Hostinger + Coolify (`services/claude-gateway/`). Drains the user's 20x Max plan instead of API credits. Resolves before OpenClaw in `lib/claw/business-client.ts`. |
| `CLAUDE_CODE_BEARER_TOKEN` | Shared secret used both as bearer auth and HMAC key (`X-Nexus-Signature`) when Nexus calls the gateway. Must match `CLAUDE_GATEWAY_BEARER` set on the gateway container. |
| `OPENCLAW_GATEWAY_URL` | Fallback OpenClaw / MyClaw gateway URL (single-tenant fallback when neither business-specific nor Claude Code config exists). |
| `OPENCLAW_BEARER_TOKEN` | Overrides cookie-based OpenClaw auth. |
| `ANTHROPIC_API_KEY` | Final fallback when both gateways are unavailable. |
| `CLAUDE_MAX_ONLY` | Set to `1` in production once every call site is migrated through the gateway. Forces `lib/claw/llm.ts::callClaude` and the auditied direct call sites (`/api/agent`, `/api/build/plan`, `lib/swarm/Queen.ts`) to refuse the API fallback so accidental gateway misconfigurations surface as visible errors instead of silent token spend. Track migration progress in `task_plan-autonomous-qa.md`. |

### Per-business OpenClaw fleet (D6 / D7)

For multi-business deployments (Pillar D in `task_plan.md`), each business AI's
gateway URL + bearer is stored in `user_secrets` with `kind = 'business:<slug>'`,
encrypted via `lib/crypto.ts`. Resolution precedence: business → user `openclaw`
default → env vars above. See `lib/claw/business-client.ts`.

| Field name (within `business:<slug>` kind) | Purpose |
|---|---|
| `gatewayUrl`   | Per-business OpenClaw gateway (e.g. `https://felix.claw.example.com`) |
| `bearerToken`  | Auth bearer for that gateway |
| `modelAlias`   | Optional override (e.g. `opus`, `sonnet-4-6`) |
| `anthropicKey` | Optional per-business Anthropic API key (single shared key by default) |

## Rate Limits / Cost

| Var | Default | Purpose |
|-----|---------|---------|
| `CLAW_DAILY_DISPATCH_CAP` | 100 | Max OpenClaw dispatches/day |
| `COST_ALERT_PER_RUN_USD` | 0.50 | Soft alert threshold per AI run (Slack/email) |
| `USER_DAILY_USD_LIMIT`    | 25   | Hard per-user daily AI-spend cap. `/api/chat` and `/api/content/generate` return HTTP 402 once hit. See `lib/cost-guard.ts`. |
| `USER_BUSINESS_DAILY_USD_LIMIT` | 10 | Hard per-business daily AI-spend cap (D10). Trips first when a dispatch carries a `businessSlug` and the business is over budget. Falls back to user cap. |

## Security (Phase 9)

| Var | Purpose |
|-----|---------|
| `ENCRYPTION_KEY` | AES-256-GCM key for user-secret / OAuth token encryption (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Required in production — `lib/crypto.ts` throws on import if missing. **Rotation:** see `rotateKey()` in `lib/crypto.ts` — set old + new keys simultaneously, re-encrypt every row, then drop the old. |
| `UPSTASH_REDIS_REST_URL` | Rate limiter (in-memory fallback if unset — do NOT rely on fallback in production, cross-lambda counters won't work) |
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
| `FIRECRAWL_API_KEY` | idea / signals | Bearer token for self-hosted Firecrawl on Coolify; also accepted by hosted Firecrawl (500 free/mo) — https://firecrawl.dev |
| `FIRECRAWL_API_URL` | signals | Base URL of self-hosted Firecrawl (e.g. `https://firecrawl.<domain>`). When unset, the hosted endpoint is used. Read by `lib/signals/firecrawl.ts` for Scout role on /signals. |
| `CRON_SECRET` | signals | Bearer secret used by Vercel Cron / GitHub Actions to call `/api/cron/signal-review` without a Clerk session. The route runs as the first user in `ALLOWED_USER_IDS`. |
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
| `NEXUS_SLACK_WEBHOOK_URL` | E7 | Single-tenant fallback Slack incoming-webhook URL for outbound notifications. Per-user override stored in `user_secrets` `kind='slack' name='webhookUrl'`. |
| `NEXUS_SLACK_SIGNING_SECRET` | E7 | Single-tenant fallback Slack app signing secret used to verify inbound slash commands. Per-user override at `kind='slack' name='signingSecret'`. |
| `SLACK_USER_<id>` | E7 | Optional. Maps a Slack user ID to a Clerk user ID so multi-operator deployments can route slash commands. e.g. `SLACK_USER_U02ABCDEF=user_2YxZ...`. Without this, `/api/webhooks/slack` falls back to the first entry of `ALLOWED_USER_IDS`. |

## Publish Pipeline (A10 / A11)

Credentials are stored in the encrypted `user_secrets` table (migration 014) per
user. No env vars are required at the platform level — the owner stores their
own OAuth credentials once via the UI.

| Kind | Required fields | Purpose |
|------|-----------------|---------|
| `youtube`   | `clientId`, `clientSecret`, `refreshToken` | YouTube Shorts publish + measure. Obtain the refresh token once via the standard Google OAuth consent flow with scope `https://www.googleapis.com/auth/youtube.upload`. |
| `tiktok`    | `accessToken` | Stubbed — pending TikTok for Developers app review. |
| `instagram` | `accessToken`, `igUserId` | Stubbed — pending Business/Creator account + content_publish permission. |

### How to get the YouTube refresh token (once, offline)

1. Google Cloud Console → create OAuth client ID (web application).
2. Add `https://developers.google.com/oauthplayground` as an authorised redirect URI.
3. Open https://developers.google.com/oauthplayground, click the gear icon, tick "Use your own OAuth credentials" and paste your client ID + secret.
4. In the scope list, add `https://www.googleapis.com/auth/youtube.upload` and authorise.
5. Exchange authorization code for tokens. Copy the `refresh_token` out.
6. POST `{ clientId, clientSecret, refreshToken }` to the platform's user-secrets endpoint (or insert manually via the tools/claw UI once extended).

## QMD sidecar (E4 / E5)

Hosted alongside the OpenClaw fleet on Hostinger Coolify. See
`docker/qmd/README.md` for the deploy runbook. Cloudflare Tunnel + Access
provides authentication (QMD itself has no auth surface).

| Var | Side | Purpose |
|-----|------|---------|
| `QMD_ENABLED` | server | Hard switch for hybrid retrieval. When unset, `lib/molecular/qmd-client.ts` no-ops and `hybridSearch` falls back to graph-only. |
| `QMD_BASE_URL` | server | Public URL of the QMD MCP HTTP server (e.g. `https://qmd.<your-domain>`). |
| `QMD_BEARER_TOKEN` | server | Cloudflare Access service token (or any reverse-proxy bearer). Sent as `Authorization: Bearer …`. |
| `MEMORY_REPO` | qmd container | Full clone URL with PAT, e.g. `https://x-access-token:<pat>@github.com/pinnacleadvisors/nexus.git`. |
| `MEMORY_BRANCH` | qmd container | Default `main`. |
| `COLLECTION_GLOB` | qmd container | Default `memory/molecular/**/*.md`. |
| `QMD_REINDEX_ON_BOOT` | qmd container | Default `1`; set `0` to skip `qmd update` on container restart. |

## Composio→Doppler broker (ADR 001)

For Claude Code web cloud sessions. Server-side route `/api/composio/doppler`
brokers OAuth-authenticated Doppler reads; sandbox calls it via
`.claude/hooks/session-start-secrets.sh` with a bearer token.

| Var | Side | Purpose |
|-----|------|---------|
| `COMPOSIO_API_KEY` | server | Composio account API key |
| `COMPOSIO_DOPPLER_CONNECTED_ACCOUNT_ID` | server | Connected-account ID returned after Composio OAuth flow to Doppler |
| `COMPOSIO_BASE_URL` | server | Optional Composio base URL (default `https://backend.composio.dev`) |
| `COMPOSIO_DOPPLER_GET_ACTION` | server | Optional action name (default `DOPPLER_GET_SECRET`) |
| `DOPPLER_PROJECT_` | server | Doppler project the broker reads from. **Trailing `_` is required** — Doppler reserves the unsuffixed `DOPPLER_PROJECT` name. |
| `DOPPLER_CONFIG_` | server | Doppler config (e.g. `prd`, `dev`). Same `_` suffix rule. |
| `COMPOSIO_BROKER_ALLOWED_SECRETS` | server | Comma-separated allowlist of secret names the broker may return |
| `CLAUDE_SESSION_BROKER_TOKEN` | both | Shared bearer secret. Server validates; sandbox presents in `Authorization: Bearer …` |
| `NEXUS_BROKER_URL` | sandbox | e.g. `https://nexus-xxx.vercel.app` |
| `NEXUS_BROKER_SECRETS` | sandbox | Optional comma-separated subset to request (defaults defined in the hook script) |

## Agent Library (managed agents)

Defined in `docs/agents/GENERATION_PROTOCOL.md` and `.claude/agents/*.md`.

| Var | Phase | Purpose |
|-----|-------|---------|
| `FIRECRAWL_API_KEY` | agents | Hosted Firecrawl API used by the `firecrawl` managed agent. If unset, the agent falls back to `/firecrawl_local`. |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | agents | Set to `1` to enable Claude Code Agent Teams (swarm). `/api/claude-session/dispatch` injects this into dispatched sessions whenever the n8n node carried `swarm: true`. Unset for normal single-agent runs. |

## AI Priority in `/api/chat`

1. **Self-hosted Claude Code gateway** (`CLAUDE_CODE_GATEWAY_URL` / `lib/claw` `kind='claude-code'`) — plan-billed via the user's 20x Max plan. Health-probed with a 60 s positive / 10 s negative cache so a dead gateway fails over fast.
2. **OpenClaw** (`OPENCLAW_GATEWAY_URL` or cookie config) — legacy fallback, retained but no longer required for new deployments.
3. **`ANTHROPIC_API_KEY`** — final API-billed fallback when both gateways are unavailable.
4. Helpful error message when nothing is configured.

## Claude Code gateway — container-side env (`services/claude-gateway/`)

Set on the Coolify service running the gateway (not on Nexus / Vercel):

| Var | Purpose |
|-----|---------|
| `CLAUDE_GATEWAY_BEARER` | Same value as Nexus's `CLAUDE_CODE_BEARER_TOKEN`. Used to validate bearer + HMAC on inbound requests. |
| `ALLOWED_USER_IDS` | Comma-separated Clerk user IDs. When set, every signed POST must carry `X-Nexus-User-Id` matching one of these. Defence-in-depth — if the bearer ever leaks, this stops it from draining your Max plan. Mirrors the Vercel-side `ALLOWED_USER_IDS` so the same value works in both places. |
| `NEXUS_REPO_URL` | Git URL the entrypoint clones into `/repo` so spawned `claude` sessions can read `.claude/agents/` + `.claude/skills/` (e.g. `https://github.com/pinnacleadvisors/nexus.git`). |
| `CLAUDE_GATEWAY_REPO_REF` | Branch / tag to check out (default `main`). |
| `QUEUE_MAX_DEPTH` | Max in-flight + pending requests (default 8). The 20x Max plan is one identity, so we serialise. |
| `REQUEST_TIMEOUT_MS` | Per-request timeout passed to the spawned `claude` CLI (default 180 000). |
| `CLAUDE_GATEWAY_PORT` | HTTP listen port (default 3000). Cloudflare Tunnel maps `claude-gw.<your-domain>` → this. |

## Memory HQ — central molecular memory (Phase A — Step 2)

Central knowledge graph at `pinnacleadvisors/memory-hq` (private). Used by every repo and AI model that integrates with the platform. Code: `lib/molecular/github-backend.mjs`, `lib/memory/scope.ts`, `lib/memory/locator.ts`, `.claude/skills/molecularmemory_local/github-commands.mjs`.

| Var | Purpose |
|-----|---------|
| `MEMORY_HQ_REPO` | Default `pinnacleadvisors/memory-hq`. Override only for staging. |
| `MEMORY_HQ_TOKEN` | **Fine-grained PAT** scoped to `pinnacleadvisors/memory-hq` only. Permissions: `Contents: Read and write` + `Metadata: Read` (the latter is auto-required for any fine-grained PAT). No Issues / PRs / Workflows / Admin / org scopes. 90-day expiry recommended. Separate from Phase 20 `MEMORY_TOKEN` so blast radius stays small if either leaks. |
| `MEMORY_AUTHOR` | Optional. Stamps `frontmatter.author` on every write (e.g. `claude-agent:nexus-architect`, `openclaw:research`, `n8n:idea-builder`). Defaults to `cli` — set per-process. |
| `MOLECULAR_BACKEND` | Optional. `local` (default) or `github`. Lets `cli.mjs` default to github mode without `--backend=github` on every call. |

### Locator credentials (only needed for resolving asset locators)

`lib/memory/locator.ts` reads these on demand. Each is optional — missing creds simply mean the locator returns `{url, content: null}` so callers fall back to the next entry in the locators array.

| Var | Used by | Purpose |
|-----|---------|---------|
| `R2_ACCOUNT_ID` | `r2` locator | Cloudflare R2 account ID (resolves to bucket URL). |
| `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | `r2` locator | S3-compatible signing creds for R2. |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_REGION` | `s3` locator | Optional — only if a memory atom points at S3 (e.g. customer assets). |
| `YOUTUBE_API_KEY` | `youtube` locator | Optional — fetches metadata/transcripts. Without it, locator still returns the watch URL. |

### Multi-AI-model writers (Phase A — Step 3, future)

When `/api/memory/event` is added, the same `MEMORY_HQ_TOKEN` is the only secret an external writer needs. OpenClaw, n8n, managed agents and external webhooks all post to that endpoint with their own `source:` value — no per-writer GitHub PATs are issued.

## Memory HQ — Supabase mirror (Step 5)

| Var | Purpose |
|-----|---------|
| `GITHUB_WEBHOOK_SECRET` | HMAC sha256 secret configured on the `pinnacleadvisors/memory-hq` repo webhook. The webhook posts to `<NEXUS_BASE_URL>/api/cron/sync-memory` on every push; the route verifies the `x-hub-signature-256` header before applying changes to the `mol_*` mirror tables. |

Webhook setup (one-time, owner action):

1. Generate a secret: `openssl rand -hex 32`
2. Add to Doppler as `GITHUB_WEBHOOK_SECRET`
3. `pinnacleadvisors/memory-hq` -> Settings -> Webhooks -> Add webhook
   - Payload URL: `https://nexus.<your-domain>/api/cron/sync-memory`
   - Content type: `application/json`
   - Secret: paste the value from step 1
   - Events: "Just the push event"
   - Active: yes
4. After setup, run a one-shot reconcile to seed the mirror:
   `curl -H "Authorization: Bearer $CRON_SECRET" "$NEXUS_BASE_URL/api/cron/sync-memory?reconcile=1"`

The nightly cron at `0 4 * * *` performs an automatic reconcile every day in case any push event was dropped.

### Bootstrap (one-time, owner action)

```bash
gh auth login                              # if not already
./scripts/bootstrap-memory-hq.sh           # creates pinnacleadvisors/memory-hq + seeds framework
# then create the fine-grained PAT and add to Doppler as MEMORY_HQ_TOKEN
```

The bootstrap script is idempotent — re-run it to sync framework changes from `docs/framework/` into `memory-hq/framework/`. Devices then `node cli.mjs --backend=github framework-pull` to refresh their local `~/.claude/CLAUDE.md`.

## Autonomous QA Loop (`task_plan-autonomous-qa.md`)

The autonomous QA loop has two surfaces — Vercel (Next.js routes + cron) and the
qa-runner service that lives next to `claude-gateway` on Coolify. Each row notes
where the secret must be present.

| Var | Where | Purpose |
|-----|-------|---------|
| `BOT_CLERK_USER_ID`        | Doppler **and** qa-runner | Clerk user ID of the dedicated `qa-bot@<your-domain>` user. Must be added to `ALLOWED_USER_IDS`. Created manually in the Clerk dashboard. |
| `BOT_API_TOKEN`            | Doppler **and** qa-runner | Random bearer the qa-runner uses to authenticate against bot-only endpoints (`/api/logs/slice`, `/api/workflow-feedback`, `/api/cron/post-deploy-smoke` manual). Generate: `openssl rand -hex 32`. |
| `BOT_ISSUER_SECRET`        | Doppler **and** qa-runner | HMAC secret for `POST /api/admin/issue-bot-session`. Binds the request body to the signature so the bearer alone can't replay with a different `userId`. Rotate quarterly. |
| `QA_RUNNER_WEBHOOK_URL`    | Doppler                   | Public URL of the qa-runner `/run` endpoint (Cloudflare Tunnel → `qa-runner:3001`). Cron POSTs here. |
| `QA_RUNNER_HMAC_SECRET`    | Doppler **and** qa-runner | HMAC secret signing the cron → qa-runner webhook. Same `X-Nexus-Signature` shape as the gateway. |
| `QA_RUNNER_BASE_URL`       | Doppler (optional)        | Default `BASE_URL` the runner targets when the cron sends an empty body. Falls back to `NEXT_PUBLIC_APP_URL`. |
| `BASE_URL`                 | qa-runner only            | Live deployment URL (e.g. `https://nexus.example.com`). Required by `playwright.config.ts`. |
| `NEXUS_BASE_URL`           | qa-runner only            | Base URL for outbound calls back into Nexus (issue-bot-session, log slice, workflow feedback). Usually equals `BASE_URL`. |
| `CLAUDE_GATEWAY_URL`       | qa-runner only            | Internal gateway URL used by the runner for fix-attempt dispatch. Default `http://claude-gateway:3000` over the `coolify` network. |
| `CLAUDE_GATEWAY_BEARER`    | qa-runner only            | Same bearer the gateway expects from Vercel. Lets the runner POST to `/api/sessions/<tag>/messages`. |

## Vercel log drain

| Var | Where | Purpose |
|-----|-------|---------|
| `VERCEL_LOG_DRAIN_SECRET`     | Doppler | HMAC secret configured on the Vercel JSON log drain (`Project Settings → Log Drains`). The `/api/vercel/log-drain` route verifies `x-vercel-signature` against the body before indexing. |
| `VERCEL_LOG_REDACT_HEADERS`   | Doppler (optional) | Comma-separated header names to scrub from `proxy.headers` before persistence. Defaults to `authorization,cookie,__session,x-clerk-session-token`. Add custom auth headers here. |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` | Doppler | Already required for Phase 17/18 assets. The drain reuses the same bucket — raw NDJSON shards land at `logs/<deployment_id>/YYYY-MM-DD/HH.jsonl`. |
