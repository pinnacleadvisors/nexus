# Nexus — Claude Code Gateway

Self-hosted Claude Code instance that drains the user's Claude 20x Max plan and
exposes the same HMAC-signed protocol the existing `dispatchToOpenClaw` already
speaks. With this deployed, Nexus's primary AI runtime stops paying per-token
API costs and becomes plan-billed instead. OpenClaw is retained as a fallback
but no longer required.

## Protocol

The gateway accepts the exact request shape `dispatchToOpenClaw` emits in
`app/api/claude-session/dispatch/route.ts`:

```
POST /api/sessions/:sessionId/messages
Authorization:    Bearer <CLAUDE_GATEWAY_BEARER>
X-Nexus-Signature: sha256=<hex of HMAC-SHA256(body, bearer)>
X-Nexus-Timestamp: <ms epoch>
Content-Type:     application/json

{ "role": "user", "content": "<task brief>", "agent": "<slug>", "env": { ... } }
```

Response:

```json
{
  "ok":        true,
  "sessionId": "nexus-agent-...",
  "agent":     "<slug>",
  "content":   "<final assistant message>",
  "usage":     { "input_tokens": ..., "output_tokens": ... },
  "durationMs": 42173
}
```

`GET /health` → `{ "ok": true, "loggedIn": true|false, "queueDepth": N }` for
liveness probes (used by Nexus to fail fast over to OpenClaw / Anthropic API).

## Deploy on Coolify + Cloudflare Tunnel

Single-machine setup:

1. Create a Coolify "Docker Compose" application pointing at this folder
   (`services/claude-gateway/docker-compose.yaml`).
2. Set environment variables on the Coolify service:
   - `CLAUDE_GATEWAY_BEARER` — random 32-byte hex; copy this same value into
     Nexus's Doppler config as `CLAUDE_CODE_BEARER_TOKEN`.
   - `NEXUS_REPO_URL` — `https://github.com/pinnacleadvisors/nexus.git`.
   - `CLAUDE_GATEWAY_REPO_REF` — `main` (or a release tag).
3. Mount a persistent volume at `/root/.claude` so the OAuth token survives
   restarts. First boot will warn that no token is present.
4. Ship a one-time `claude login` into the volume:

   ```bash
   # On the Hostinger box, after the container is up:
   docker exec -it claude-gateway claude login
   # Follow the OAuth flow in your browser.
   docker exec -it claude-gateway claude --version
   ```

5. Add a Cloudflare Tunnel ingress mapping `claude-gw.<your-domain>` →
   `claude-gateway:3000`. The compose attaches the service to the shared
   external `coolify` network with the alias `claude-gateway`, so the URL is
   stable across container recreates. (Cloudflare's `cloudflared` container
   must also be on the `coolify` network — which it is by default in v4.)
6. Set Doppler `CLAUDE_CODE_GATEWAY_URL=https://claude-gw.<your-domain>` and
   `CLAUDE_CODE_BEARER_TOKEN=<same as gateway CLAUDE_GATEWAY_BEARER>`. Vercel
   redeploys automatically.
7. Verify from Nexus: `curl https://claude-gw.<your-domain>/health` should
   return `{"ok":true,"loggedIn":true,...}`.
8. Run the end-to-end smoke test from your laptop — it validates the bearer,
   probes `/health`, asserts an unsigned POST is rejected, then sends a real
   signed POST and verifies the spawned `claude` CLI replies:

   ```bash
   BEARER=<the same hex you set as CLAUDE_GATEWAY_BEARER> \
   HOST=https://claude-gw.<your-domain> \
     ./services/claude-gateway/scripts/smoke.sh
   ```

   Diagnoses common 401 causes (`bad-bearer`, `bad-signature`, `stale-timestamp`)
   and 502 (`claude` not logged in) with explicit fixes. Portable across Linux
   and macOS (handles BSD `date`).

## Concurrency

The gateway is a single-worker FIFO queue (Max plan = one identity). Burst
requests serialise; a queue depth >8 is rejected with 503 so n8n workflows fail
fast rather than backing up. Bump `QUEUE_MAX_DEPTH` if you add a second seat.

## Debugging `401 bad-signature` from outside

When a signed POST works from inside the Docker network (`docker run --rm
--network coolify curlimages/curl ...`) but fails through Cloudflare Tunnel,
something in transit is mutating bytes the HMAC was computed over. Set
`DEBUG_HMAC=1` on the Coolify service, redeploy, and replay the request.
The gateway logs:

```
[debug-hmac] verdict=bad-signature
[debug-hmac] bodyLen=74
[debug-hmac] bodyHex=7b22726f6c65...
[debug-hmac] bodyAscii="{\"role\":\"user\",...}"
[debug-hmac] sigReceived=sha256=...
[debug-hmac] sigExpected=sha256=...
[debug-hmac] bearerHashSent=9c0a2e0cb1f0e03a...
[debug-hmac] bearerHashEnv =9c0a2e0cb1f0e03a...
[debug-hmac] tsReceived=... tsParsed=... now=...
```

Compare `bodyHex` from the failing run against the bytes your client signs.
Any difference (extra bytes, encoding change, lowercased Unicode) is what
the tunnel is doing. **Unset `DEBUG_HMAC` once you have the data** — the
log line includes a SHA-256 of the bearer + the full request body, both of
which are sensitive.

## Local dev

```bash
cd services/claude-gateway
npm install
NEXUS_REPO_PATH=$(pwd)/../.. CLAUDE_GATEWAY_BEARER=local-dev npm run dev
```

The CLI must already be logged in (`~/.claude` populated) for spawn calls to
return real responses; otherwise spawn returns an error and the route returns
502 to the caller.

## Why this exists

See `task_plan-claude-gateway.md` (North Star + plan). TL;DR: the 20x Max plan
covers all CLI usage; routing Nexus's primary AI traffic through this gateway
means we stop spending API credits on the same workloads.
