#!/bin/bash
# Brings the Nexus local-OS stack up at login/boot. Invoked by the LaunchAgent
# com.nexus.local-os. Idempotent + safe to re-run. Waits for OrbStack's Docker
# daemon, ensures the shared network exists, then `compose up -d`.
set -uo pipefail

REPO="/Users/dylan_mini/Dev/nexus"
COMPOSE="$REPO/services/local-os/docker-compose.yaml"
ENVFILE="$REPO/services/local-os/.env"
LOG="$REPO/services/local-os/startup.log"
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:$PATH"

log() { echo "$(date '+%Y-%m-%dT%H:%M:%S') $*" >>"$LOG"; }

log "=== local-os startup invoked ==="

# 1. Make sure OrbStack's docker engine is up (it starts at login; give it time).
if ! docker version >/dev/null 2>&1; then
  log "docker not ready — launching OrbStack and waiting"
  open -a OrbStack 2>>"$LOG" || true
fi
for i in $(seq 1 60); do
  docker version >/dev/null 2>&1 && break
  sleep 3
done
if ! docker version >/dev/null 2>&1; then
  log "ERROR: docker daemon never became ready after 180s — aborting"
  exit 1
fi
log "docker ready"

# 2. Shared external network the compose includes expect.
docker network inspect coolify >/dev/null 2>&1 || { docker network create coolify >>"$LOG" 2>&1 && log "created coolify network"; }

# 3. Bring the stack up (restart:unless-stopped handles steady state; this
#    reconciles against the compose + restarts anything that was removed).
if [ ! -f "$ENVFILE" ]; then log "ERROR: $ENVFILE missing (DOPPLER_TOKEN) — aborting"; exit 1; fi
cd "$REPO" || exit 1
set -a; . "$ENVFILE"; set +a
docker compose -f "$COMPOSE" --env-file "$ENVFILE" up -d >>"$LOG" 2>&1
rc=$?
log "compose up -d exit=$rc"
docker compose -f "$COMPOSE" ps --format '{{.Service}}: {{.Status}}' >>"$LOG" 2>&1
log "=== startup complete ==="
exit 0
