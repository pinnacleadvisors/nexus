# Claude Code Gateway on Hostinger + Coolify — Integration Plan

> Branch: `claude/claude-code-hostinger-n8n-iFIHs`
> Sister plan: `task_plan.md` (Self-Optimising Ecosystem) — independent workstream.

## North Star

**Goal:** Stand up a self-hosted Claude Code instance on Hostinger (via Coolify + Cloudflare Tunnel) that drains the user's Claude 20x Max plan instead of API credits, exposes the same HMAC-signed `POST /api/sessions/:id/messages` protocol the existing `dispatchToOpenClaw` already speaks, and becomes the **primary** AI runtime for Nexus — with OpenClaw retained only as a documented fallback (not yet deployed).

**Success criteria:**
- Coolify service `claude-gateway` is live behind a Cloudflare Tunnel hostname; `GET /health` returns 200 from the public Nexus app.
- One-time `claude login` against the Max plan; OAuth token persisted in a Coolify volume (survives container restarts).
- `POST /api/sessions/:id/messages` accepts the exact body shape `dispatchToOpenClaw` sends (`{role, content, agent, env}`), verifies the HMAC signature, runs `claude -p` with the supplied agent spec + message, returns the assistant's final response as JSON.
- `lib/claw/business-client.ts` resolves Claude Code gateway **before** OpenClaw: `business → user 'claude-code' → user 'openclaw' → env CLAUDE_CODE_GATEWAY_URL → env OPENCLAW_GATEWAY_URL → null`.
- `/api/chat` priority order updated to: Claude Code gateway → OpenClaw → `ANTHROPIC_API_KEY`.
- New env vars added to `memory/platform/SECRETS.md` + Doppler dev config.
- `npx tsc --noEmit` passes. PR opened as draft.

**Hard constraints:**
- Must not break the existing OpenClaw code path — it stays as fallback even though no instance is deployed. Removing OpenClaw is out of scope for this PR.
- No secrets committed. All gateway credentials in Doppler (server) + Coolify env (gateway side).
- HMAC verification on every request — bearer alone is not enough since the protocol already requires both.
- The gateway repo path is `services/claude-gateway/` inside this monorepo so Coolify deploys it on the same git push that updates `.claude/agents/` and `.claude/skills/` — single source of truth, no drift.
- Skills (`.claude/skills/`) and agents (`.claude/agents/`) live in the Nexus repo. The gateway container clones the same repo (or mounts it) so they're available to spawned Claude sessions.
- Stack rules in `AGENTS.md`: Next.js 16, no `tailwind.config.js`, types in `lib/types.ts`, etc.

---

## Phase 1 — Explore (findings)

### What already exists

- **`dispatchToOpenClaw`** (`app/api/claude-session/dispatch/route.ts:233-277`) — POSTs to `${gatewayUrl}/api/sessions/<sessionId>/messages` with HMAC SHA-256 signature in `X-Nexus-Signature`, bearer in `Authorization`, body `{role, content, agent, env}`.
- **`resolveClawConfig`** (`lib/claw/business-client.ts:64-86`) — three-tier fallback: `business:<slug>` user_secret → `openclaw` user_secret → `OPENCLAW_GATEWAY_URL` env. Returns `{gatewayUrl, bearerToken, modelAlias?, anthropicKey?}`.
- **`/api/chat`** is the user-facing streaming endpoint; uses OpenClaw → Anthropic priority.
- **Doppler-Composio broker** (ADR 001) already exists for serving secrets to Claude Code sandboxes — the gateway can reuse the same `CLAUDE_SESSION_BROKER_TOKEN` pattern for its own auth where helpful.
- **Coolify** is already configured on Hostinger with a Cloudflare Tunnel — no public IP, no port forwarding.

### What's missing

1. No self-hosted Claude Code service exists.
2. `resolveClawConfig` only knows about OpenClaw; needs a Claude-Code-aware tier.
3. No `services/` directory — needs scaffolding.
4. No `claude-code` user-secret kind defined (mirror of `openclaw` kind).

---

## Phase 2 — Plan

### Decision points (asked of user before implementation)

1. **Concurrency model on the gateway:** spawn-per-request (simple, possible plan-side throttling) vs single-worker queue (deterministic, safe for one Max seat). **Default: single-worker queue with FIFO + 60 s per-message timeout.**
2. **Repo strategy on the gateway container:** mount the live Nexus repo as a read-only volume (instant skill/agent updates) vs clone-on-deploy (deterministic, restart needed). **Default: clone-on-deploy via Coolify's git integration; restart on push.**
3. **Auth between Nexus and gateway:** the existing OpenClaw HMAC + bearer protocol is fine — no need to invent something new.

### Atomic task list

#### G1 — Scaffold `services/claude-gateway/`
- File: `services/claude-gateway/package.json` (new), `services/claude-gateway/tsconfig.json` (new), `services/claude-gateway/Dockerfile` (new), `services/claude-gateway/.dockerignore` (new), `services/claude-gateway/README.md` (new)
- Change: Node 22 service using `hono` (light, edge-friendly) for HTTP, `zod` for input validation, `@anthropic-ai/claude-code` CLI as the runtime. Dockerfile installs the CLI globally + `git` so the container can clone the Nexus repo at boot.
- Verify: `docker build services/claude-gateway -t claude-gateway` succeeds locally (or sanity-check the Dockerfile by hand).
- Parallel: yes.

#### G2 — HTTP server skeleton
- File: `services/claude-gateway/src/index.ts` (new), `services/claude-gateway/src/auth.ts` (new)
- Change: Hono app with routes `GET /health`, `POST /api/sessions/:id/messages`. `auth.ts` exports `verifyHmac(req, sharedSecret)` matching the SHA-256 hex format `dispatchToOpenClaw` emits in `X-Nexus-Signature`.
- Verify: `curl localhost:3000/health` → `{ok:true}`; unsigned POST → 401; correctly-signed POST → 200 (echo for now).
- Parallel: depends on G1.

#### G3 — Claude CLI spawn wrapper
- File: `services/claude-gateway/src/spawn.ts` (new)
- Change: function `runClaude({agentSlug, message, env, timeoutMs})` that builds `claude -p --output-format stream-json --append-system-prompt <agent-spec-or-empty> --max-turns 25` and pipes the message via stdin. Streams JSON, captures the final assistant message, returns `{ok, content, sessionId, usage?}`. Honours a per-request timeout via `AbortController`.
- Verify: with a real `~/.claude` token mounted in dev, `runClaude({message:"hello", agentSlug:"none", env:{}})` returns a content string and a usage object.
- Parallel: depends on G1.

#### G4 — Single-worker queue
- File: `services/claude-gateway/src/queue.ts` (new)
- Change: trivial FIFO `enqueue(fn): Promise<T>` so concurrent HTTP requests serialise into the single Claude CLI process. Length cap = 8; reject with 503 when full.
- Verify: 10 parallel requests → first 8 queue, 9th + 10th get 503.
- Parallel: depends on G1.

#### G5 — Wire route → queue → spawn
- File: `services/claude-gateway/src/index.ts` (edit)
- Change: in `POST /api/sessions/:id/messages`, parse body via Zod, `verifyHmac`, then `enqueue(() => runClaude(…))`, return JSON `{ok, sessionId, content, usage}`.
- Verify: end-to-end curl from another container hits the route, output streams a real Claude reply.
- Parallel: depends on G2, G3, G4.

#### G6 — Agent spec resolution at runtime
- File: `services/claude-gateway/src/spawn.ts` (edit)
- Change: when `agentSlug` is provided, read `.claude/agents/<slug>.md` from the cloned repo, strip frontmatter, pass body via `--append-system-prompt`. If the spec doesn't exist, run with no system prompt (fallback identical to OpenClaw's behaviour today).
- Verify: dispatch with `agentSlug:"nexus-architect"` produces a response that mentions architecture rules; with a missing slug, request still succeeds.
- Parallel: depends on G3.

#### G7 — Coolify deploy config + Cloudflare tunnel notes
- File: `services/claude-gateway/coolify.md` (new — instructions, not auto-deploy), `services/claude-gateway/docker-compose.yaml` (new — Coolify resource template)
- Change: documented steps — create Coolify "Docker Compose" resource pointing at `services/claude-gateway/docker-compose.yaml`, add Cloudflare Tunnel ingress for `claude-gw.<your-domain>` → `claude-gateway:3000`, mount a persistent volume at `/root/.claude` for the OAuth token, add env vars `CLAUDE_GATEWAY_BEARER`, `CLAUDE_GATEWAY_REPO_REF` (default `main`).
- Verify: docs walk-through is reproducible by reading once.
- Parallel: depends on G1.

#### G8 — Update `resolveClawConfig` to add Claude Code tier
- File: `lib/claw/business-client.ts` (edit), `lib/types.ts` (edit if needed)
- Change: add a new precedence layer above OpenClaw — `claude-code` user_secret kind (gatewayUrl, bearerToken, modelAlias?), and `CLAUDE_CODE_GATEWAY_URL` + `CLAUDE_CODE_BEARER_TOKEN` env fallback. Return shape unchanged so the existing dispatch code path is untouched. New helper `resolveClaudeCodeFirst(userId, businessSlug?)` that documents the Claude → OpenClaw → null priority.
- Verify: unit-test stub or manual: with both env sets present, the resolver returns the Claude Code one; with only OpenClaw, returns OpenClaw.
- Parallel: depends on plan approval.

#### G9 — Update `/api/chat` priority order
- File: `app/api/chat/route.ts` (edit)
- Change: switch to `resolveClaudeCodeFirst` → Anthropic API key fallback. Add a 3 s health-probe cache (in-memory) so a dead gateway fails over quickly without hammering it on every chat.
- Verify: `curl /api/chat` with valid auth returns a response; if `CLAUDE_CODE_GATEWAY_URL` is unreachable, falls back to Anthropic API without user-visible error.
- Parallel: depends on G8.

#### G10 — Health-probe + failover helper
- File: `lib/claw/health.ts` (new)
- Change: `isGatewayHealthy(url): Promise<boolean>` with 1.5 s timeout, 60 s positive-cache, 10 s negative-cache. Used by `/api/chat` and `/api/claude-session/dispatch`.
- Verify: with a fake unreachable URL, first call returns false in ≤ 2 s; subsequent calls return false instantly from cache.
- Parallel: depends on plan approval.

#### G11 — Update `memory/platform/SECRETS.md`
- File: `memory/platform/SECRETS.md` (edit)
- Change: add `CLAUDE_CODE_GATEWAY_URL`, `CLAUDE_CODE_BEARER_TOKEN`, plus container-side vars (`CLAUDE_GATEWAY_REPO_REF`, `CLAUDE_GATEWAY_PORT`).
- Verify: file edited; `grep CLAUDE_CODE_GATEWAY` returns the new entries.
- Parallel: yes.

#### G12 — Update AGENTS.md priority order
- File: `AGENTS.md` (edit)
- Change: change "AI priority in `/api/chat`" line from `OpenClaw → ANTHROPIC_API_KEY` to `Claude Code gateway → OpenClaw → ANTHROPIC_API_KEY`. Update `Optional env vars` paragraph.
- Verify: file edited.
- Parallel: yes.

#### G13 — TypeScript pre-flight + commit + push + draft PR
- Change: `npx tsc --noEmit` from repo root. `git add` only the new/edited files (no `-A`). Commit with a clear message. Push `claude/claude-code-hostinger-n8n-iFIHs` with `-u origin`. Open draft PR.
- Verify: PR URL returned.
- Parallel: depends on every other task.

### Risks / open contracts

- **`claude` CLI auth inside Docker**: the OAuth flow opens a browser. Workaround: bring up the container locally first, run `claude login` against the mounted volume, copy the populated `~/.claude` to the Coolify volume on first deploy. Document in `coolify.md`.
- **Single-seat concurrency**: the Max plan is one identity. The single-worker queue is the safe default; if you later add a second seat, swap `queue.ts` for a multi-worker pool. Out of scope for this PR.
- **Cost control**: the gateway is plan-billed (no per-token charge), so the existing `assertUnderCostCap` is a no-op for these calls. Leave it in place for fallback paths.
- **Skill access on the gateway**: agents that call `/api/claude-session/dispatch` from inside a gateway-spawned session would create an infinite loop. Document that the gateway is a leaf — it does not call back into itself. Enforced socially for now; harden later if needed.

---

## Progress (as of 2026-04-27)

### Completed
- [x] G1 — `services/claude-gateway/` scaffolded (`package.json`, `tsconfig.json`, `Dockerfile`, `entrypoint.sh`, `docker-compose.yaml`, `README.md`).
- [x] G2 — HMAC verifier (`src/auth.ts`) using `node:crypto`, constant-time bearer compare, 5-minute timestamp window.
- [x] G3 — Claude CLI spawn wrapper (`src/spawn.ts`) parsing `stream-json` events, capturing the terminal `result` event for usage + content.
- [x] G4 — Single-worker FIFO queue (`src/queue.ts`) with depth cap → 503.
- [x] G5 — Hono HTTP server (`src/index.ts`) wiring zod-validated body → HMAC → queue → spawn.
- [x] G6 — Agent-spec resolver (`src/agentSpec.ts`) reads `.claude/agents/<slug>.md` from the cloned repo and feeds the body via `--append-system-prompt`.
- [x] G7 — Coolify Docker Compose template + Cloudflare Tunnel deploy notes in README.
- [x] G8 — `lib/claw/business-client.ts` adds `resolveClaudeCodeConfig` and inserts the Claude Code tier above OpenClaw in `resolveClawConfig`. Existing dispatch code path is unchanged — it now prefers Claude Code automatically.
- [x] G9 — `/api/chat` tries Claude Code gateway first (signed HMAC), falls through to OpenClaw, then Anthropic API key.
- [x] G10 — `lib/claw/health.ts` health-probe with 60 s positive / 10 s negative cache.
- [x] G11 — `memory/platform/SECRETS.md` documents `CLAUDE_CODE_GATEWAY_URL`, `CLAUDE_CODE_BEARER_TOKEN`, and the gateway-side env vars.
- [x] G12 — `AGENTS.md` priority order updated.
- [x] Root `tsconfig.json` excludes `services/` so the Next.js typecheck doesn't sweep the gateway sources.
- [x] `npx tsc --noEmit` passes at the repo root and inside `services/claude-gateway/`.

### Remaining
- [x] G13 — Commit, push `claude/claude-code-hostinger-n8n-iFIHs`, open draft PR.

### Shipped — full sequence

| PR | Subject | Status |
|---|---|---|
| #47 | feat(gateway): self-hosted Claude Code gateway for Hostinger + Coolify | merged |
| #50 | fix(gateway): join external coolify network with stable alias | merged |
| #51 | feat(gateway): add scripts/smoke.sh end-to-end test | merged |
| #53 | feat(gateway): DEBUG_HMAC env var to diagnose in-transit body mutation | merged |
| #54 | fix(gateway): smoke.sh portable openssl output parsing (macOS LibreSSL) | merged |

### Live verification (2026-04-28)

- `GET /health` from public URL → `{"ok":true,"loggedIn":true,...}` ✅
- Unsigned `POST /api/sessions/test/messages` → `401 missing-bearer` ✅
- Signed `POST /api/sessions/smoke/messages` → `200 OK` with `content: "pong"`, `usage.cache_read_input_tokens: 22164` (prompt caching active) ✅
- All three smoke checks pass on macOS (LibreSSL) and Linux (OpenSSL 3.x).
- `/api/chat` priority is Claude Code gateway → OpenClaw → Anthropic API. Doppler vars `CLAUDE_CODE_GATEWAY_URL` + `CLAUDE_CODE_BEARER_TOKEN` set in Production.

### Lessons promoted to molecular memory (`memory/molecular/atoms/`)

- `claude-code-gateway-deployment-pattern` — Hostinger + Coolify v4 + Cloudflare Tunnel architecture
- `coolify-v4-per-service-network-isolation` — every Compose stack gets a private bridge; explicit attach to the shared `coolify` network is required for cross-stack traffic
- `coolify-secret-changes-require-redeploy` — secret env var edits do not propagate on container restart; must Redeploy
- `cloudflare-tunnel-multi-tunnel-orphan-trap` — Public Hostnames must live on the *running* tunnel; orphan tunnels return 1033
- `macos-libressl-openssl-dgst-output-differs` — `openssl dgst -sha256 -hmac` output format diverges from GNU OpenSSL 3.x; parse with `awk '{print $NF}'`
- `coolify-image-tag-plus-build-causes-pull-attempt` — declaring both `image:` and `build:` triggers an unauthenticated registry pull before the build; use `pull_policy: build` or drop the tag
- `claude-gateway-hmac-protocol` — POST `/api/sessions/:id/messages` with bearer + HMAC-SHA256 over body in `X-Nexus-Signature` + millisecond timestamp; matches `dispatchToOpenClaw`

### Out of scope (follow-ups)
- Failover signal in `/api/claude-session/dispatch` route (currently still uses the existing 30 s OpenClaw timeout — fine for now, fast-failover is a nice-to-have).
- Routines / scheduled triggers — wait until a stable v0 of the gateway is running on Hostinger before adding cron callers.
- Computer Use, Files API, Batch API integrations — see strategic recommendation in chat history; sequenced after this PR ships.

### Blockers / Open Questions
- None — gateway is fully live and serving production traffic.
