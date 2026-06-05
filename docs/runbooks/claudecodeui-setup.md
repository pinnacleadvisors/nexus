# claudecodeui setup (the `/code` chat engine)

Phase 1 of the chat-engine replacement ([ADR 013](../adr/013-chat-engine-replacement.md)). Runs
[siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) (npm name `@cloudcli-ai/cloudcli`)
on the Mac as the OSS Claude Code chat engine; Nexus surfaces it at `/code` and keeps the governance
views (Inbox/Approvals/Tasks). claudecodeui drives the host `claude` CLI — which already has the MCP
substrate registered ([mcp-substrate runbook](mcp-substrate.md)), so chats inherit memory + connectors.

> **✅ DEPLOYED 2026-06-05.** Live at `https://code.coolifycloudtunnel.uk`, embedded at `/code`
> (verified: iframe renders, zero CSP violations — `npm run test:e2e:authed -- code-page.spec.ts`).
> Persisted via the launchd agent `com.workforce.claudecodeui` (KeepAlive). Reproducible artifacts +
> re-provision steps: [`services/local-os/claudecodeui/`](../../services/local-os/claudecodeui/README.md).
> The sections below are the original how-it-was-done reference.

> **Operator-run.** This executes third-party code that can drive Claude Code (i.e. do anything on the
> box). Run it yourself / authorize explicitly — agents should not auto-run it. The source is verified
> (active repo, last commit 2026-06-02). Cloned read-only at `~/Dev/claudecodeui`.

## 1. Install + run (loopback, port 3010 — avoids the claude-gateway on 3001)

```bash
cd ~/Dev/claudecodeui
npm install                      # runs a node-pty native build (postinstall)
printf 'SERVER_PORT=3010\nHOST=127.0.0.1\n' > .env
npm run start                    # build (client+server) then serve on :3010
# open http://127.0.0.1:3010 → register your operator user (its own auth: /api/auth/register)
```

Persist it (like Paperclip) with a launchd agent once happy — mirror `~/Dev/workforce-lab/run-paperclip.sh`
+ `com.workforce.paperclip.plist` (call it `com.workforce.claudecodeui`).

> ✅ Done — the launchd agent `com.workforce.claudecodeui` (KeepAlive + RunAtLoad) runs
> [`run-claudecodeui.sh`](../../services/local-os/claudecodeui/run-claudecodeui.sh), which serves the
> prebuilt bundle (`npm run server`). Both artifacts are committed under
> [`services/local-os/claudecodeui/`](../../services/local-os/claudecodeui/README.md). After pulling a
> new claudecodeui version, rebuild then `launchctl kickstart -k gui/$(id -u)/com.workforce.claudecodeui`.

## 2. Expose via the tunnel (WebSocket-compatible; claudecodeui needs WS for live streaming)

claudecodeui is WS-heavy, so it CANNOT go through Nexus's same-origin Next-route proxy. Use the
Cloudflare tunnel instead (cloudflared proxies WS natively); claudecodeui's own login protects it.

- Add an ingress rule to [`services/local-os/cloudflared/config.yml`](../../services/local-os/cloudflared/config.yml):
  ```yaml
    - hostname: code.coolifycloudtunnel.uk
      service: http://host.docker.internal:3010
  ```
  then `docker compose -f services/local-os/docker-compose.yaml restart cloudflared`. ✅ done.
- Add the DNS CNAME `code.coolifycloudtunnel.uk → <nexus-mac tunnel id>.cfargotunnel.com` (proxied) — same
  pattern as the other hostnames (see AGENTS.md#topology). ✅ done — created against tunnel
  `b741e21c-1f8c-4843-b52e-600ba76b8460` (proxied) using the `CLOUDFLARE_NEXUS_COOLIFY_MIGRATION` token in
  Doppler. NOTE: `scripts/cloudflare-tunnel-add-hostname.mjs` discovers the tunnel via its **API-managed**
  ingress, which is empty for the file-config-managed nexus-mac tunnel — so for this tunnel the ingress
  edit is manual (config.yml above) and only the DNS CNAME goes through the API.
- In claudecodeui, allow `nexus.coolifycloudtunnel.uk` as a frame-ancestor if you want the in-page iframe
  (otherwise use the "Open claudecodeui" button — new tab always works).

## 3. Nexus side (already shipped)
- `/code` page links + best-effort-iframes `CODE_EMBED_URL` (default `https://code.coolifycloudtunnel.uk`)
  and surfaces the preserved governance rail (Inbox / Approvals / Tasks).
- Override the URL via `CODE_EMBED_URL` in Doppler if you host claudecodeui elsewhere.

## Next phases (ADR 013)
- **P2:** Claude Code Stop-hook → `POST /api/chat/ingest-turn` (reuse `parseTurnBlocks` + `persistCompletedTurn`)
  so typed blocks emitted in claudecodeui flow into the governance views.
- **P3:** re-home the platform/business copilot context as a Claude Code `CLAUDE.md`/agent config.
- **P4:** retire `PlatformChat.tsx` after soak.
