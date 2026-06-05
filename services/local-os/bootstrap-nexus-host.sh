#!/bin/bash
# Bootstrap the Nexus public-services stack under the dedicated `nexus-host`
# user (P0 security remediation, Task 2 steps 3-6). RUN THIS AS nexus-host,
# inside a nexus-host Terminal (switch via fast-user-switching first).
#
# Prereq (operator does this ONCE from a dylan_mini admin Terminal, because
# nexus-host cannot read dylan_mini's 0600 secret files):
#   sudo rsync -a --delete /Users/dylan_mini/Dev/nexus/        /Users/nexus-host/Dev/nexus/
#   sudo rsync -a --delete /Users/dylan_mini/Dev/claudecodeui/ /Users/nexus-host/Dev/claudecodeui/
#   sudo chown -R nexus-host:staff /Users/nexus-host/Dev
# (rsync carries the gitignored secrets: services/local-os/.env,
#  cloudflared/credentials.json, businesses/*.env, and the prebuilt CCUI bundle.)
#
# Idempotent + safe to re-run. Does NOT tear down the old dylan_mini stack —
# that is a separate, gated step (teardown-dylan-services.sh) run only after
# this host is verified healthy, to avoid downtime.
set -uo pipefail

NEW_USER="nexus-host"
HOME_DIR="/Users/${NEW_USER}"
REPO="${HOME_DIR}/Dev/nexus"
CCUI="${HOME_DIR}/Dev/claudecodeui"
LOS="${REPO}/services/local-os"
COMPOSE="${LOS}/docker-compose.yaml"
ENVFILE="${LOS}/.env"
LA="${HOME_DIR}/Library/LaunchAgents"
ORB="/Applications/OrbStack.app/Contents/MacOS/xbin"
export PATH="/usr/local/bin:/opt/homebrew/bin:${ORB}:${PATH}"

say()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mABORT: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- preflight
say "Preflight"
[ "$(id -un)" = "$NEW_USER" ] || die "Run this AS ${NEW_USER} (you are $(id -un)). Switch users first."
if id -Gn | tr ' ' '\n' | grep -qx admin; then
  printf '   \033[33m! %s is in the admin group — recommend removing it (a service account should not sudo).\033[0m\n' "$NEW_USER"
fi
[ -d "$REPO" ] || die "$REPO missing — run the rsync prereq above first."
[ -f "$ENVFILE" ] || die "$ENVFILE missing — the DOPPLER_TOKEN didn't copy. Re-run the rsync+chown prereq."
[ -d "$CCUI" ] || die "$CCUI missing — run the rsync prereq."
ok "running as $NEW_USER; repo + .env + claudecodeui present"

# Rewrite the two launch artifacts that hardcode /Users/dylan_mini.
say "Rewriting launch paths dylan_mini -> ${NEW_USER}"
sed -i '' "s#/Users/dylan_mini#${HOME_DIR}#g" "${LOS}/startup.sh" "${CCUI}/run-claudecodeui.sh" 2>/dev/null || true
ok "startup.sh + run-claudecodeui.sh repointed"

# ---------------------------------------------------------------- OrbStack
say "Step 3 — OrbStack (per-user Docker engine)"
[ -d /Applications/OrbStack.app ] || die "OrbStack not installed in /Applications."
orb start >/dev/null 2>&1 || open -a OrbStack
for i in $(seq 1 40); do docker version >/dev/null 2>&1 && break; sleep 3; done
docker version >/dev/null 2>&1 || die "OrbStack docker engine never came up. Open OrbStack.app manually (enable Start at login), then re-run."
ctx="$(docker context show 2>/dev/null)"
echo "$ctx" | grep -qi orb || printf '   \033[33m! docker context is %s, expected orbstack\033[0m\n' "$ctx"
ok "docker engine up ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"

# ---------------------------------------------------------------- stack up
say "Step 4 — Bring the stack up (build + run) under ${NEW_USER}"
docker network inspect coolify >/dev/null 2>&1 || { docker network create coolify >/dev/null && ok "created coolify network"; }
cd "$REPO" || die "cd $REPO failed"
set -a; . "$ENVFILE"; set +a
[ -n "${DOPPLER_TOKEN:-}" ] || die "DOPPLER_TOKEN empty in $ENVFILE"
docker compose -f "$COMPOSE" --env-file "$ENVFILE" up -d --build || die "compose up failed (see output above)"
ok "compose up -d --build done"
docker compose -f "$COMPOSE" ps --format '   {{.Service}}: {{.Status}}'

# ---------------------------------------------------------------- claudecodeui (host process)
say "Step 5 — claudecodeui (host /code engine) + its login"
# node + claude CLI must exist for nexus-host (CCUI drives the host `claude` CLI).
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  printf '   \033[33m! node not found for %s. Install nvm+node and the `claude` CLI, then re-run:\033[0m\n' "$NEW_USER"
  echo '     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
  echo '     . ~/.nvm/nvm.sh && nvm install 24 && npm i -g @anthropic-ai/claude-code'
  die "node missing — claudecodeui cannot run without it"
fi
ok "node: $NODE_BIN"
command -v claude >/dev/null 2>&1 && ok "claude CLI present" || \
  printf '   \033[33m! `claude` CLI not on PATH — install + run `claude` once to log in (claudecodeui needs it).\033[0m\n'
# Build the bundle if it wasn't copied built.
if [ ! -d "${CCUI}/dist" ] && [ ! -d "${CCUI}/build" ]; then
  ( cd "$CCUI" && npm install && npm run build ) || printf '   \033[33m! claudecodeui build failed — fix before /code works.\033[0m\n'
fi
# Fresh login DB (per-user; not copied) -> first /register sets the single account.
if [ -f "${HOME_DIR}/.cloudcli/auth.db" ]; then
  ok "claudecodeui auth.db exists (login already registered)"
else
  printf '   \033[33mACTION: after launch, open https://code.coolifycloudtunnel.uk and register the single\n   account with a LONG RANDOM password (registration locks after the first user).\033[0m\n'
fi

# ---------------------------------------------------------------- LaunchAgents
say "Step 6a — Install + load LaunchAgents (autostart at login)"
mkdir -p "$LA"
# Rewrite plist paths for nexus-host home, then install.
sed "s#/Users/dylan_mini#${HOME_DIR}#g" "${LOS}/com.nexus.local-os.plist" > "${LA}/com.nexus.local-os.plist"
if [ -f "/Users/dylan_mini/Library/LaunchAgents/com.workforce.claudecodeui.plist" ]; then
  : # can't read dylan_mini's; regenerate from the template below instead
fi
cat > "${LA}/com.workforce.claudecodeui.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.workforce.claudecodeui</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>${CCUI}/run-claudecodeui.sh</string></array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${CCUI}/claudecodeui.launchd.out.log</string>
  <key>StandardErrorPath</key><string>${CCUI}/claudecodeui.launchd.err.log</string>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
PLIST
GUI="gui/$(id -u)"
launchctl bootout  "$GUI/com.nexus.local-os"        2>/dev/null || true
launchctl bootout  "$GUI/com.workforce.claudecodeui" 2>/dev/null || true
launchctl bootstrap "$GUI" "${LA}/com.nexus.local-os.plist"        && ok "loaded com.nexus.local-os"
launchctl bootstrap "$GUI" "${LA}/com.workforce.claudecodeui.plist" && ok "loaded com.workforce.claudecodeui"

# ---------------------------------------------------------------- verify
say "Step 6b — Verify"
sleep 4
docker compose -f "$COMPOSE" ps --format '   {{.Service}}: {{.Status}}'
printf '   nexus-app  : '; curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000      2>/dev/null || echo "no answer yet (build may still be settling)"
printf '   claude-gw  : '; curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/health 2>/dev/null || echo "no answer yet"
printf '   codex-gw   : '; curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/health 2>/dev/null || echo "no answer yet"
printf '   claudecodeui: '; curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010      2>/dev/null || echo "not up yet (LaunchAgent may still be starting / needs node+claude)"

say "Done on ${NEW_USER}."
cat <<NEXT
Next:
  1. Confirm the public hostnames serve from THIS host:
       curl -sI https://nexus.coolifycloudtunnel.uk | head -1
       curl -sI https://code.coolifycloudtunnel.uk  | head -1
  2. Register the claudecodeui login (long random password) if prompted above.
  3. Keep this ${NEW_USER} session LOGGED IN (locking the screen is fine; do not log out).
  4. ONLY THEN tear down the old dylan_mini stack — from a dylan_mini shell run:
       bash ${REPO}/services/local-os/teardown-dylan-services.sh
NEXT
