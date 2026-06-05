# claudecodeui — the `/code` chat engine (ADR 013)

Reproducible launch artifacts for [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)
running on the Mac mini as the OSS Claude Code chat engine. Nexus surfaces it at `/code`.
Full setup + rationale: [`docs/runbooks/claudecodeui-setup.md`](../../../docs/runbooks/claudecodeui-setup.md).

## What runs where

- **App**: `~/Dev/claudecodeui` (read-only clone), prebuilt bundle served on `127.0.0.1:3010`
  (config in `~/Dev/claudecodeui/.env` → `SERVER_PORT=3010`, `HOST=127.0.0.1`).
- **Persistence**: launchd agent `com.workforce.claudecodeui` (KeepAlive + RunAtLoad) →
  runs [`run-claudecodeui.sh`](run-claudecodeui.sh). Survives reboot + restarts on crash.
- **Public ingress**: the `nexus-mac` cloudflared tunnel routes
  `code.coolifycloudtunnel.uk` → `http://host.docker.internal:3010` (ingress rule in
  [`../cloudflared/config.yml`](../cloudflared/config.yml)); DNS CNAME points at the
  nexus-mac tunnel (`b741e21c….cfargotunnel.com`, proxied).
- **Nexus side**: `/code` best-effort-iframes `CODE_EMBED_URL`
  (default `https://code.coolifycloudtunnel.uk`). `connect-src` in `next.config.ts`
  allows `*.coolifycloudtunnel.uk` so the reachability probe + WebSocket aren't CSP-blocked.

## Files here (machine-local copies, committed for reproducibility)

| File | Lives at runtime |
|------|------------------|
| `run-claudecodeui.sh` | `~/Dev/claudecodeui/run-claudecodeui.sh` |
| `com.workforce.claudecodeui.plist` | `~/Library/LaunchAgents/com.workforce.claudecodeui.plist` |

These carry machine-specific absolute paths (same convention as `../com.nexus.local-os.plist`).

## Re-provision from scratch

```bash
# 1. App
cd ~/Dev/claudecodeui && npm install && npm run build
printf 'SERVER_PORT=3010\nHOST=127.0.0.1\n' > .env

# 2. Persistence
cp services/local-os/claudecodeui/run-claudecodeui.sh ~/Dev/claudecodeui/
cp services/local-os/claudecodeui/com.workforce.claudecodeui.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.workforce.claudecodeui.plist

# 3. Tunnel ingress (already in config.yml) + DNS CNAME
docker compose -f services/local-os/docker-compose.yaml restart cloudflared
doppler run -- node scripts/cloudflare-tunnel-add-hostname.mjs \
  --hostname=code.coolifycloudtunnel.uk --service=http://host.docker.internal:3010 --apply
#   ^ NOTE: the nexus-mac tunnel is FILE-config-managed, so the script's
#     ingress step is a no-op for it — ingress lives in config.yml. The DNS
#     CNAME was created directly against the tunnel id b741e21c… (proxied).
```

## Update to a new claudecodeui version

```bash
cd ~/Dev/claudecodeui && git pull && npm install && npm run build
launchctl kickstart -k gui/$(id -u)/com.workforce.claudecodeui   # restart cleanly
```

## Verify

```bash
curl -I https://code.coolifycloudtunnel.uk/        # 200 through the tunnel
npm run test:e2e:authed -- code-page.spec.ts       # /code embeds it, no CSP violation
```
