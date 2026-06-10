#!/usr/bin/env bash
# nexus-stack.sh — on/off switch for the Nexus local-OS stack on the Mac mini.
#
# Frees RAM for local testing (e.g. openhuman / paperclip / shopify) WITHOUT
# losing state, then brings everything back. Path-independent: derives the repo
# root from its own location, so it works regardless of which user owns the
# checkout (the old startup.sh hardcodes /Users/dylan_mini — this does not).
#
#   ./nexus-stack.sh down      # stop the Nexus containers (OrbStack stays up
#                              #   so your Docker-based tests keep working)
#   ./nexus-stack.sh up        # bring the whole stack back
#   ./nexus-stack.sh status    # what's running + free RAM (read-only)
#
# `down` flags:
#   --remove        `compose down` (remove containers) instead of `stop`
#                   (keep them). `stop` is faster to resume; both preserve
#                   images + named volumes, so no data loss either way.
#   --orbstack      ALSO stop the OrbStack VM — frees the MOST RAM. Use only
#                   when your testing does NOT need Docker/OrbStack itself.
#   --no-autostart  bootout the login LaunchAgent so a re-login won't silently
#                   restart the stack (handy if you want it to stay off a while).
#
# `up` reverses whatever `down` did: starts OrbStack if it was stopped, restarts
# the main stack + any per-business containers, and re-bootstraps the login
# agent if it was booted out.
#
# See README.md (this dir) and AGENTS.md#topology for what each container does.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$REPO/services/local-os/docker-compose.yaml"
ENVFILE="$REPO/services/local-os/.env"
AGENT_LABEL="com.nexus.local-os"
AGENT_PLIST="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
ORB_BIN="/Applications/OrbStack.app/Contents/MacOS/xbin/orb"
export PATH="/Applications/OrbStack.app/Contents/MacOS/xbin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# compose wrapper — only pass --env-file when it exists (stop/down don't need it)
C() {
  local env_arg=()
  [ -f "$ENVFILE" ] && env_arg=(--env-file "$ENVFILE")
  docker compose -f "$COMPOSE" "${env_arg[@]}" "$@"
}

business_containers() { docker ps -a --filter "name=nexus-business-" --format '{{.Names}}' 2>/dev/null; }
agent_loaded()        { launchctl print "gui/$(id -u)/${AGENT_LABEL}" >/dev/null 2>&1; }
orbstack_running()    { pgrep -x OrbStack >/dev/null 2>&1; }

cmd_status() {
  local freepct rss
  freepct="$(memory_pressure 2>/dev/null | awk -F': ' '/free percentage/{print $2}')"
  rss="$(ps -Ao rss,comm 2>/dev/null | awk '/OrbStack/{s+=$1} END{printf "%.1fGB", s/1048576}')"
  echo "▸ macOS memory free: ${freepct:-unknown}"
  echo "▸ OrbStack VM: $(orbstack_running && echo running || echo stopped)  (~${rss} RSS)"
  if docker version >/dev/null 2>&1; then
    echo "▸ main stack (project local-os):"
    local ps_out; ps_out="$(C ps --format '{{.Service}}: {{.Status}}' 2>/dev/null)"
    if [ -n "$ps_out" ]; then echo "$ps_out" | sed 's/^/   /'; else echo "   (all stopped)"; fi
    local biz; biz="$(business_containers)"
    if [ -n "$biz" ]; then echo "▸ business containers:"; echo "$biz" | sed 's/^/   /'; else echo "▸ business containers: none"; fi
  else
    echo "▸ docker daemon not reachable (OrbStack stopped)"
  fi
  echo "▸ login autostart agent: $(agent_loaded && echo loaded || echo not-loaded)"
}

cmd_down() {
  local remove=0 orbstack=0 noauto=0 a
  for a in "$@"; do case "$a" in
    --remove)       remove=1 ;;
    --orbstack)     orbstack=1 ;;
    --no-autostart) noauto=1 ;;
    *) echo "unknown flag: $a"; exit 2 ;;
  esac; done

  if ! docker version >/dev/null 2>&1; then echo "docker not reachable — stack already down."; cmd_status; exit 0; fi

  local biz; biz="$(business_containers)"
  if [ -n "$biz" ]; then echo "stopping business containers…"; echo "$biz" | xargs docker stop >/dev/null; fi

  if [ "$remove" = 1 ]; then echo "compose down (removing containers)…"; C down
  else echo "stopping main stack (compose stop)…"; C stop; fi

  if [ "$noauto" = 1 ] && agent_loaded; then
    launchctl bootout "gui/$(id -u)/${AGENT_LABEL}" 2>/dev/null && echo "login autostart disabled (will NOT restart on re-login)"
  fi

  if [ "$orbstack" = 1 ]; then
    echo "stopping OrbStack VM (frees the most RAM)…"
    "$ORB_BIN" stop 2>/dev/null || osascript -e 'quit app "OrbStack"' 2>/dev/null || true
    sleep 2
  fi

  echo "✓ Nexus stack down — RAM freed for testing."
  echo
  cmd_status
}

cmd_up() {
  if ! docker version >/dev/null 2>&1; then
    echo "starting OrbStack…"
    "$ORB_BIN" start 2>/dev/null || open -a OrbStack 2>/dev/null || true
    for _ in $(seq 1 60); do docker version >/dev/null 2>&1 && break; sleep 3; done
  fi
  if ! docker version >/dev/null 2>&1; then echo "ERROR: docker never became ready after 180s"; exit 1; fi

  docker network inspect coolify >/dev/null 2>&1 || { docker network create coolify >/dev/null && echo "created coolify network"; }
  [ -f "$ENVFILE" ] || { echo "ERROR: $ENVFILE missing (DOPPLER_TOKEN) — cannot start"; exit 1; }
  set -a; . "$ENVFILE"; set +a

  echo "starting main stack (compose up -d)…"
  C up -d

  local biz; biz="$(business_containers)"
  if [ -n "$biz" ]; then echo "restarting business containers…"; echo "$biz" | xargs docker start >/dev/null; fi

  if [ -f "$AGENT_PLIST" ] && ! agent_loaded; then
    launchctl bootstrap "gui/$(id -u)" "$AGENT_PLIST" 2>/dev/null && echo "login autostart re-enabled"
  fi

  echo "✓ Nexus stack up."
  echo
  cmd_status
}

case "${1:-status}" in
  down)   shift; cmd_down "$@" ;;
  up)     shift; cmd_up   "$@" ;;
  status) cmd_status ;;
  *) echo "usage: nexus-stack.sh {down|up|status} [--remove] [--orbstack] [--no-autostart]"; exit 2 ;;
esac
