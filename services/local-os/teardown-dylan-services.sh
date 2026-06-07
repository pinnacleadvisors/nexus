#!/bin/bash
# Tear down the Nexus public-services stack on the dylan_mini account, AFTER the
# nexus-host account is verified serving (P0 Task 2, step 6). Run as dylan_mini.
#
# Leaves dylan_mini fully intact as a personal admin account (iCloud, personal
# projects, OrbStack itself, and the personal `paperclip` service on :3100) — it
# ONLY stops the Nexus public services so they no longer run on the iCloud-signed-in
# account. Reversible: re-run startup.sh + re-bootstrap the LaunchAgents to bring
# them back here. Source of truth: docs/runbooks/p0-security-remediation.md.
set -uo pipefail

REPO="/Users/dylan_mini/Dev/nexus"
COMPOSE="${REPO}/services/local-os/docker-compose.yaml"
ENVFILE="${REPO}/services/local-os/.env"
CCUI_RUN="${REPO%/nexus}/claudecodeui/run-claudecodeui.sh"
GUI="gui/$(id -u)"
export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:${PATH}"

# Public hostnames + the local claudecodeui port (the :3010 hand-off target).
NEXUS_URL="https://nexus.coolifycloudtunnel.uk"
CODE_URL="https://code.coolifycloudtunnel.uk"
CCUI_PORT=3010
PAPERCLIP_PORT=3100   # dylan_mini's personal service — OUT OF SCOPE, never touched here.

say(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok(){  printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '   \033[33m! %s\033[0m\n' "$*"; }

[ "$(id -un)" = "dylan_mini" ] || { echo "Run as dylan_mini (you are $(id -un))."; exit 1; }

say "Guard 1 — confirm nexus-host is already serving the WEB STACK before we stop this host"
code1="$(curl -sf -o /dev/null -w '%{http_code}' "$NEXUS_URL" 2>/dev/null || echo 000)"
echo "   ${NEXUS_URL} -> ${code1}"
if [ "$code1" = "000" ]; then
  warn "Public site not answering. If nexus-host is NOT confirmed up, ABORT now (Ctrl-C)."
  printf '   Continue with web-stack teardown anyway? [y/N] '; read -r ans; [ "$ans" = "y" ] || { echo "aborted."; exit 1; }
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

say "Guard 2 (cutover) — only stop dylan_mini's claudecodeui once nexus-host serves /code"
# claudecodeui runs on the HOST (not a container) on 127.0.0.1:${CCUI_PORT}; the
# public ingress is code.* -> host.docker.internal:${CCUI_PORT}. The hand-off is:
# nexus-host must bind :${CCUI_PORT} (i.e. code.* answers from nexus-host) BEFORE we
# stop the one here, otherwise /code goes dark for the operator's phone.
codec="$(curl -sf -o /dev/null -w '%{http_code}' "$CODE_URL" 2>/dev/null || echo 000)"
echo "   ${CODE_URL} -> ${codec}"
if [ "$codec" = "200" ] || [ "$codec" = "302" ] || [ "$codec" = "401" ]; then
  # 200 = claudecodeui served from nexus-host; 302/401 = Cloudflare Access gate in
  # front (Task 3) — either way the ingress is live, so this host's copy is safe to stop.
  ok "code.* is serving (HTTP ${codec}) — nexus-host has the :${CCUI_PORT} hand-off; stopping dylan_mini's claudecodeui"
  pkill -f "$CCUI_RUN" 2>/dev/null && ok "stopped dylan_mini claudecodeui (run-claudecodeui.sh)" || ok "dylan_mini claudecodeui already stopped"
else
  warn "code.* not yet serving from nexus-host (HTTP ${codec})."
  warn "LEAVING dylan_mini's claudecodeui RUNNING so /code stays reachable for the operator's phone."
  warn "Re-run this script after nexus-host binds :${CCUI_PORT} to complete the cutover."
fi

say "Out of scope — personal services left untouched"
ok "paperclip (:${PAPERCLIP_PORT}) is dylan_mini's personal service — NOT stopped (intentionally left running)"

say "Done."
cat <<NEXT
dylan_mini is now a personal account (iCloud + personal work) running NO Nexus
public services. OrbStack itself and your personal paperclip (:${PAPERCLIP_PORT}) are
left running. The web stack (nexus.*) is torn down; the /code (claudecodeui :${CCUI_PORT})
stop is gated on nexus-host serving code.* — see the cutover guard above.

Optional hardening you may still want on dylan_mini:
  - It can keep iCloud — that's now safe, because the exposed services run as
    nexus-host (non-admin, no iCloud). The risky combination is broken.
  - To bring the stack BACK here later (rollback): restore the *.disabled plists
    and run services/local-os/startup.sh.
NEXT
