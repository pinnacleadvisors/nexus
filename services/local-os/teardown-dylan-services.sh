#!/bin/bash
# Tear down the Nexus public-services stack on the dylan_mini account, AFTER the
# nexus-host account is verified serving (P0 Task 2, step 6). Run as dylan_mini.
#
# Leaves dylan_mini fully intact as a personal admin account (iCloud, personal
# projects, OrbStack itself) — it ONLY stops the Nexus public services so they
# no longer run on the iCloud-signed-in account. Reversible: re-run
# startup.sh + re-bootstrap the LaunchAgents to bring them back here.
set -uo pipefail

REPO="/Users/dylan_mini/Dev/nexus"
COMPOSE="${REPO}/services/local-os/docker-compose.yaml"
ENVFILE="${REPO}/services/local-os/.env"
GUI="gui/$(id -u)"
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:${PATH}"

say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){  printf '   \033[32m✓\033[0m %s\n' "$*"; }

[ "$(id -un)" = "dylan_mini" ] || { echo "Run as dylan_mini (you are $(id -un))."; exit 1; }

say "Guard — confirm nexus-host is already serving before we stop this host"
code1="$(curl -sf -o /dev/null -w '%{http_code}' https://nexus.coolifycloudtunnel.uk 2>/dev/null || echo 000)"
echo "   https://nexus.coolifycloudtunnel.uk -> ${code1}"
if [ "$code1" = "000" ]; then
  printf '   \033[33m! Public site not answering. If nexus-host is NOT confirmed up, ABORT now (Ctrl-C).\033[0m\n'
  printf '   Continue anyway? [y/N] '; read -r ans; [ "$ans" = "y" ] || { echo "aborted."; exit 1; }
fi

say "Unload dylan_mini LaunchAgents (stop autostart)"
launchctl bootout "$GUI/com.nexus.local-os"        2>/dev/null && ok "booted out com.nexus.local-os"        || ok "com.nexus.local-os not loaded"
launchctl bootout "$GUI/com.workforce.claudecodeui" 2>/dev/null && ok "booted out com.workforce.claudecodeui" || ok "com.workforce.claudecodeui not loaded"
# Prevent re-load at next login (rename out of the active dir).
for p in com.nexus.local-os com.workforce.claudecodeui; do
  f="/Users/dylan_mini/Library/LaunchAgents/${p}.plist"
  [ -f "$f" ] && mv "$f" "${f}.disabled" && ok "disabled ${p}.plist (renamed .disabled)"
done

say "Stop the Nexus containers on dylan_mini's OrbStack"
if docker version >/dev/null 2>&1; then
  docker compose -f "$COMPOSE" --env-file "$ENVFILE" down 2>/dev/null && ok "compose down" || ok "nothing to stop (already down / moved)"
else
  ok "docker engine not running here — nothing to stop"
fi
# Stop the host claudecodeui process if still alive.
pkill -f "${REPO%/nexus}/claudecodeui/run-claudecodeui.sh" 2>/dev/null || true
pkill -f "claudecodeui" 2>/dev/null || true

say "Done."
cat <<NEXT
dylan_mini is now a clean personal account (iCloud + personal work), running NO
Nexus public services. OrbStack itself is left installed for your own use.

Optional hardening you may still want on dylan_mini:
  - It can keep iCloud — that's now safe, because the exposed services run as
    nexus-host (non-admin, no iCloud). The risky combination is broken.
  - To bring the stack BACK here later (rollback): restore the *.disabled plists
    and run services/local-os/startup.sh.
NEXT
